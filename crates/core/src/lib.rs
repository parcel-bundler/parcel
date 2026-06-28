mod asset;
mod asset_graph;
mod bundle;
mod bundle_graph;
mod bundler;
mod config;
mod content;
mod dependency;
mod diagnostic;
mod entry;
mod fs;
mod invalidations;
mod location;
mod namer;
mod optimizer;
mod options;
mod path;
mod request;
mod resolver;
mod target;
mod transformer;

use std::{
  collections::{HashMap, HashSet},
  path::{Path, PathBuf},
  sync::Arc,
};

use rayon::iter::{IndexedParallelIterator, IntoParallelRefIterator, ParallelIterator};

pub use asset::*;
pub use asset_graph::{AssetGraph, AssetGraphBuilder, AssetNode};
pub use bundle::*;
pub use bundle_graph::*;
pub use bundler::*;
pub use config::*;
pub use content::*;
pub use dependency::*;
pub use diagnostic::*;
pub use entry::*;
pub use fs::*;
pub use invalidations::*;
pub use location::*;
pub use namer::*;
pub use optimizer::Optimizer;
pub use options::*;
pub use path::PathId;
pub use resolver::Resolver;
pub use target::*;
pub use transformer::Transformer;

/// Builds a `PluginFactory` from the file system it should read plugins/configs through.
///
/// `Parcel::new` wraps the input file system in a [`TrackingFileSystem`] and hands it to this
/// builder so that files read by the factory (extended configs, plugin lookups) are tracked
/// alongside the files core reads directly. The builder is stored so `Parcel` can rebuild itself
/// from scratch when a configuration file changes.
pub type FactoryBuilder = dyn Fn(Arc<dyn FileSystem>) -> Box<dyn PluginFactory>;

pub struct Parcel {
  asset_graph_builder: AssetGraphBuilder,
  config: Arc<ParcelConfig>,
  options: Arc<ParcelOptions>,
  /// The shared file-system cache used as `options.input_fs`. Stale entries are dropped from it in
  /// `invalidate` so the resolver, transformers, and JS environment all see fresh data on rebuild.
  cached_fs: Arc<CachedFileSystem>,
  /// Metadata from the previous bundle pass used to detect which bundles need re-packaging.
  /// Keyed by bundle name; value is (sorted asset indices, dist path).
  prev_bundles: HashMap<String, (Vec<usize>, PathId)>,
  /// Original constructor inputs, retained so the build can be recreated from scratch when a
  /// configuration file changes.
  entries: Vec<String>,
  build_options: BuildOptions,
  make_factory: Arc<FactoryBuilder>,
  /// Files read while loading configuration during `Parcel::new`. A change to any of them
  /// requires a full rebuild rather than an incremental one.
  config_invalidations: InvalidationMap,
}

/// The outcome of [`Parcel::invalidate`].
#[derive(Debug, Default)]
pub struct InvalidateResult {
  /// Asset indices invalidated for an incremental rebuild.
  pub affected: HashSet<usize>,
  /// True if a configuration file changed and the `Parcel` was rebuilt from scratch. In that case
  /// `affected` is empty and the next `build()` performs a full build.
  pub config_changed: bool,
}

impl InvalidateResult {
  /// Whether the next `build()` will produce different output (and is therefore worth running).
  pub fn needs_rebuild(&self) -> bool {
    self.config_changed || !self.affected.is_empty()
  }
}

impl Parcel {
  pub fn new(
    entries: &Vec<String>,
    options: BuildOptions,
    make_factory: Arc<FactoryBuilder>,
  ) -> Result<Parcel, DiagnosticList> {
    // Keep the original constructor inputs so the build can be recreated on a config change.
    let build_options = options.clone();

    // Wrap the input file system in a shared cache used for the whole build, so the resolver,
    // transformers, and JS environment all read through one warm cache that we invalidate centrally.
    let cached_fs = Arc::new(CachedFileSystem::new(options.input_fs.clone()));

    // Route all configuration-time reads (entries, dotenv, .parcelrc and its extends, plugin
    // lookups done by the factory) through a tracker (over the cache) so we learn which files were
    // consulted while still warming the cache.
    let tracker = Arc::new(TrackingFileSystem::new(cached_fs.clone()));
    let mut options = options;
    options.input_fs = tracker.clone();

    let factory = make_factory(tracker.clone());
    let factory: &dyn PluginFactory = &*factory;

    let (resolved_entries, project_root) = resolve_entries(entries, &options)?;

    let mut env = options.env;
    load_dotenv(project_root, &*options.input_fs, &mut env)?;

    let config_file = options
      .config
      .map(|c| options.cwd.join(Path::new(&c)))
      .unwrap_or_else(|| project_root.child(".parcelrc"));
    let config = Arc::new(
      if options
        .input_fs
        .kind(config_file)
        .contains(FileKind::IS_FILE)
      {
        ParcelConfig::read(&*options.input_fs, config_file, factory)?
      } else {
        factory.config("@parcel/config-default", config_file)?
      },
    );

    let project_root = project_root.with_path(|p| SourceUrl::from_absolute_directory_path(p))?;

    // The tracker accumulated the files read while loading configuration. Fold them into a map
    // keyed by a single sentinel index. Entry source files are stat'd while resolving entries, but
    // editing one should trigger an incremental rebuild, not a full one — so drop them.
    let mut config_invalidations = InvalidationMap::default();
    config_invalidations.add(0, tracker.take());
    for entry in &resolved_entries {
      if let Ok(url) = entry.url.to_file_url(&project_root) {
        config_invalidations.on_file_change.remove(&url);
        config_invalidations.on_file_create_path.remove(&url);
      }
    }

    let options = Arc::new(ParcelOptions {
      env,
      mode: options.mode,
      log_level: options.log_level,
      project_root,
      input_fs: cached_fs.clone(),
      output_fs: options.output_fs,
      cwd: options.cwd,
    });

    Ok(Parcel {
      asset_graph_builder: AssetGraphBuilder::new(
        resolved_entries,
        config.clone(),
        options.clone(),
      ),
      config,
      options,
      cached_fs,
      prev_bundles: HashMap::new(),
      entries: entries.clone(),
      build_options,
      make_factory,
      config_invalidations,
    })
  }

  pub fn project_root(&self) -> &SourceUrl {
    &self.options.project_root
  }

  /// Marks files as changed ahead of the next `build()`.
  ///
  /// `changed` are files that were modified or deleted; `created` are newly created files. If any
  /// of them was read while loading configuration (`.parcelrc`, `.env`, etc.) — or, for created
  /// files, matches a tracked glob / ancestor-config pattern — the entire `Parcel` is rebuilt from
  /// scratch in place and the result reports `config_changed`. Otherwise only the affected assets
  /// are invalidated for an incremental rebuild.
  pub fn invalidate(
    &mut self,
    changed: &[SourceUrl],
    created: &[SourceUrl],
  ) -> Result<InvalidateResult, DiagnosticList> {
    if self.is_config_change(changed, created) {
      // Recreate first; on failure (e.g. an invalid config edit) leave `self` untouched so the
      // last good build remains usable.
      let parcel = Parcel::new(
        &self.entries,
        self.build_options.clone(),
        self.make_factory.clone(),
      )?;
      *self = parcel;
      return Ok(InvalidateResult {
        affected: HashSet::new(),
        config_changed: true,
      });
    }

    // Drop stale entries from the shared file-system cache before re-resolving/re-transforming, so
    // the resolver and transformers see the changed files. Intern each changed/created path to a
    // `PathId` at this boundary (SourceUrl-based invalidation is a deferred migration).
    let paths: Vec<PathId> = changed
      .iter()
      .chain(created)
      .filter_map(|url| url.to_file_path(&self.options.project_root).ok())
      .collect();
    self.cached_fs.invalidate(paths);

    let affected = self.asset_graph_builder.invalidate(changed, created);
    Ok(InvalidateResult {
      affected,
      config_changed: false,
    })
  }

  /// Returns true if any of the changed/created files was read while loading configuration.
  pub fn is_config_change(&self, changed: &[SourceUrl], created: &[SourceUrl]) -> bool {
    // The tracker recorded config files as absolute `file://` URLs; normalize the event URLs
    // (which may be `project://`) to match.
    let to_file = |urls: &[SourceUrl]| -> Vec<SourceUrl> {
      urls
        .iter()
        .filter_map(|url| url.to_file_url(&self.options.project_root).ok())
        .collect()
    };
    !self
      .config_invalidations
      .invalidate(&to_file(changed), &to_file(created))
      .is_empty()
  }

  pub fn build(&mut self) -> Result<BundleGraph, DiagnosticList> {
    let asset_graph = self.asset_graph_builder.build()?;
    self.bundle(asset_graph)
  }

  pub fn bundle(&mut self, asset_graph: AssetGraph) -> Result<BundleGraph, DiagnosticList> {
    // Group assets into bundles.
    let bundle_graph = bundle(asset_graph, &self.config, &*self.options)?;

    // Diff the new bundle graph against the previous build's metadata to find dirty bundles.
    // A bundle is dirty if it's new, its asset composition changed, or any of its assets
    // were re-transformed this build.
    let changed = &self.asset_graph_builder.changed_assets;
    let mut new_prev: HashMap<String, (Vec<usize>, PathId)> = HashMap::new();
    let mut dirty: HashSet<usize> = HashSet::new();

    for (bundle_index, bundle) in bundle_graph.bundles.iter().enumerate() {
      if bundle.bundle_behavior == BundleBehavior::Inline {
        continue;
      }

      let name = bundle.name.as_ref().unwrap();
      let dist_path = bundle.dist_path(&self.options.project_root);

      let mut sorted_assets = bundle.assets.clone();
      sorted_assets.sort_unstable();

      let is_dirty = match self.prev_bundles.get(name) {
        None => true,
        Some((prev_assets, _)) => {
          *prev_assets != sorted_assets || bundle.assets.iter().any(|i| changed.contains(i))
        }
      };

      if is_dirty {
        dirty.insert(bundle_index);
      }

      new_prev.insert(name.clone(), (sorted_assets, dist_path));
    }

    // Delete output files for bundles that no longer exist.
    for (name, (_, dist_path)) in &self.prev_bundles {
      if !new_prev.contains_key(name) {
        self.options.output_fs.remove_file(*dist_path).ok();
      }
    }

    self.prev_bundles = new_prev;

    let opts = &*self.options;
    bundle_graph
      .bundles
      .par_iter()
      .enumerate()
      .for_each(|(bundle_index, bundle)| {
        if dirty.contains(&bundle_index) {
          let content = get_bundle_content(&self.config, &bundle_graph, bundle, opts).unwrap();
          let path = bundle.dist_path(&opts.project_root);
          let parent = path.parent().unwrap();
          opts.output_fs.create_dir_all(parent).ok();
          content.write(&*opts.output_fs, path).ok();
        }
      });

    Ok(bundle_graph)
  }
}

pub fn build(
  entries: &Vec<String>,
  options: BuildOptions,
  make_factory: Arc<FactoryBuilder>,
) -> Result<BundleGraph, DiagnosticList> {
  let mut parcel = Parcel::new(entries, options, make_factory)?;
  parcel.build()
}

fn get_bundle_content(
  config: &ParcelConfig,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  options: &ParcelOptions,
) -> Result<Arc<dyn Content>, DiagnosticList> {
  let first_content = &bundle_graph.asset_graph.assets[bundle.assets[0]]
    .expect_asset()
    .content;
  let get_inline_bundle_content = |bundle_index| {
    get_bundle_content(
      config,
      bundle_graph,
      &bundle_graph.bundles[bundle_index],
      options,
    )
  };

  let mut content =
    first_content.package(&bundle_graph, &bundle, &get_inline_bundle_content, options)?;

  let mut pipeline = None;
  if let Some(main) = bundle.main_entry_asset {
    pipeline = bundle_graph.asset_graph.assets[main]
      .expect_asset()
      .pipeline
      .clone();
  }
  let optimizers = config
    .optimizers
    .get(bundle.name.as_ref().unwrap(), &pipeline, false);

  for optimizer in optimizers.0 {
    content = optimizer.optimize(&bundle_graph, &bundle, content)?;
  }

  Ok(content)
}

// By default, bitflags serializes as a string, but we want the raw number instead.
macro_rules! impl_bitflags_serde {
  ($t: ty) => {
    impl Serialize for $t {
      fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
      where
        S: serde::Serializer,
      {
        self.bits().serialize(serializer)
      }
    }

    impl<'de> Deserialize<'de> for $t {
      fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
      where
        D: serde::Deserializer<'de>,
      {
        let bits = Deserialize::deserialize(deserializer)?;
        Ok(<$t>::from_bits_truncate(bits))
      }
    }
  };
}

pub(crate) use impl_bitflags_serde;

fn load_dotenv(
  project_root: PathId,
  fs: &dyn FileSystem,
  env: &mut HashMap<String, String>,
) -> Result<(), DiagnosticList> {
  if let Some(node_env) = env.get("NODE_ENV").cloned() {
    for file in ["", ".local"] {
      let path = project_root.child(&format!(".env.{}{}", node_env, file));
      if fs.kind(path) == FileKind::IS_FILE {
        let content = fs.read(path)?;
        let iter = dotenvy::from_read_iter(std::io::BufReader::new(std::io::Cursor::new(content)));
        for item in iter {
          if let Ok((key, value)) = item {
            env.entry(key).or_insert(value);
          }
        }
      }
    }
  }

  for file in [".env", ".env.local"] {
    let path = project_root.child(file);
    if fs.kind(path) == FileKind::IS_FILE {
      let content = fs.read(path)?;
      let iter = dotenvy::from_read_iter(std::io::BufReader::new(std::io::Cursor::new(content)));
      for item in iter {
        if let Ok((key, value)) = item {
          env.entry(key).or_insert(value);
        }
      }
    }
  }

  Ok(())
}
