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
  borrow::Cow,
  collections::{HashMap, HashSet},
  path::Path,
  sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
  },
};

use crossbeam_channel::bounded;
use rayon::iter::{IndexedParallelIterator, IntoParallelRefIterator, ParallelIterator};

pub use asset::*;
pub use asset_graph::{AssetGraph, AssetGraphBuilder, AssetIndex, AssetNode, AssetNodeIndex};
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
pub use path::{PathId, SubPath};
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

const OUTPUT_WRITER_THREADS: usize = 4;

pub struct Parcel {
  asset_graph_builder: AssetGraphBuilder,
  pub config: Arc<ParcelConfig>,
  pub options: Arc<ParcelOptions>,
  /// The shared file-system cache used as `options.input_fs`. Stale entries are dropped from it in
  /// `invalidate` so the resolver, transformers, and JS environment all see fresh data on rebuild.
  cached_fs: Arc<CachedFileSystem>,
  /// Metadata from the previous bundle pass used to detect which bundles need re-packaging.
  /// Keyed by bundle dist path; value is the bundle's sorted asset indices.
  prev_bundles: HashMap<PathId, Vec<AssetIndex>>,
  /// Original constructor inputs, retained so the build can be recreated from scratch when a
  /// configuration file changes.
  entries: Vec<String>,
  build_options: BuildOptions,
  make_factory: Arc<FactoryBuilder>,
  /// Files read while loading configuration during `Parcel::new`. A change to any of them
  /// requires a full rebuild rather than an incremental one.
  config_invalidations: InvalidationMap,
}

#[derive(Debug)]
pub struct BuildResult<'a> {
  pub bundle_graph: BundleGraph<'a>,
  pub changed_assets: Vec<AssetIndex>,
}

impl<'a> BuildResult<'a> {
  pub fn changed_assets(&'a self) -> Vec<(AssetIndex, &'a Asset)> {
    self
      .changed_assets
      .iter()
      .filter_map(|index| Some((*index, self.bundle_graph.asset_graph.asset(*index))))
      .collect()
  }
}

/// The outcome of [`Parcel::invalidate`].
#[derive(Debug, Default)]
pub struct InvalidateResult {
  /// Asset indices invalidated for an incremental rebuild.
  pub affected: HashSet<AssetNodeIndex>,
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

    // The tracker accumulated the files read while loading configuration. Fold them into a map
    // keyed by a single sentinel index. Entry source files are stat'd while resolving entries, but
    // editing one should trigger an incremental rebuild, not a full one — so drop them.
    let mut config_invalidations = InvalidationMap::default();
    config_invalidations.add(AssetNodeIndex(0), tracker.take());
    for entry in &resolved_entries {
      if let Ok(url) = entry.url.to_file_path() {
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

  pub fn project_root(&self) -> PathId {
    self.options.project_root
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
    changed: &[PathId],
    created: &[PathId],
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

    let paths: Vec<PathId> = changed.iter().chain(created).copied().collect();
    self.cached_fs.invalidate(paths);

    let affected = self.asset_graph_builder.invalidate(changed, created);
    Ok(InvalidateResult {
      affected,
      config_changed: false,
    })
  }

  /// Returns true if any of the changed/created files was read while loading configuration.
  pub fn is_config_change(&self, changed: &[PathId], created: &[PathId]) -> bool {
    !self
      .config_invalidations
      .invalidate(changed, created)
      .is_empty()
  }

  pub fn build(&mut self) -> Result<BundleGraph<'_>, DiagnosticList> {
    Ok(self.build_with_changes()?.bundle_graph)
  }

  pub fn build_with_changes(&mut self) -> Result<BuildResult<'_>, DiagnosticList> {
    let result = self.asset_graph_builder.build_with_changes()?;
    let changed_assets = result.changed_assets;
    let bundle_graph = bundle_and_package(
      result.asset_graph,
      &self.config,
      &self.options,
      &changed_assets,
      &mut self.prev_bundles,
    )?;

    Ok(BuildResult {
      bundle_graph,
      changed_assets,
    })
  }

  pub fn build_owned(self) -> Result<BundleGraph<'static>, DiagnosticList> {
    let Parcel {
      asset_graph_builder,
      config,
      options,
      mut prev_bundles,
      ..
    } = self;
    let result = asset_graph_builder.build_owned_with_changes()?;
    bundle_and_package(
      result.asset_graph,
      &config,
      &options,
      &result.changed_assets,
      &mut prev_bundles,
    )
  }
}

fn bundle_and_package<'a>(
  asset_graph: AssetGraph<'a>,
  config: &ParcelConfig,
  options: &ParcelOptions,
  changed_assets: &Vec<AssetIndex>,
  prev_bundles: &mut HashMap<PathId, Vec<AssetIndex>>,
) -> Result<BundleGraph<'a>, DiagnosticList> {
  // Group assets into bundles.
  let bundle_graph = bundle(asset_graph, config, options)?;

  // Diff the new bundle graph against the previous build's metadata to find dirty bundles.
  // A bundle is dirty if it's new, its asset composition changed, or any of its assets
  // were re-transformed this build.
  let mut new_prev: HashMap<PathId, Vec<AssetIndex>> = HashMap::new();
  let mut dirty: HashSet<usize> = HashSet::new();

  for (bundle_index, bundle) in bundle_graph.bundles.iter().enumerate() {
    if bundle.bundle_behavior == BundleBehavior::Inline {
      continue;
    }

    let dist_path = bundle.dist_path();

    let mut sorted_assets = bundle.assets.clone();
    sorted_assets.sort_unstable();

    let is_dirty = match prev_bundles.get(&dist_path) {
      None => true,
      Some(prev_assets) => {
        *prev_assets != sorted_assets || bundle.assets.iter().any(|i| changed_assets.contains(i))
      }
    };

    if is_dirty {
      dirty.insert(bundle_index);
    }

    new_prev.insert(dist_path, sorted_assets);
  }

  // Delete output files for bundles that no longer exist.
  for dist_path in prev_bundles.keys() {
    if !new_prev.contains_key(dist_path) {
      match options.output_fs.remove_file(*dist_path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
          return Err(
            Diagnostic::from_message(format!("Failed to remove stale {:?}: {}", dist_path, e))
              .into(),
          );
        }
      }
    }
  }

  *prev_bundles = new_prev;

  // Create each output directory once before packaging starts. Library builds can emit thousands
  // of bundles into a much smaller number of shared directories, so calling create_dir_all for
  // every bundle adds significant filesystem metadata overhead.
  let mut output_dirs = HashSet::new();
  for &bundle_index in &dirty {
    let path = bundle_graph.bundles[bundle_index].dist_path();
    let parent = path
      .parent()
      .ok_or_else(|| Diagnostic::from_message(format!("{:?} has no parent directory", path)))?;
    output_dirs.insert(parent);
  }

  for dir in output_dirs {
    options
      .output_fs
      .create_dir_all(dir)
      .map_err(|e| Diagnostic::from_message(format!("Failed to create {:?}: {}", dir, e)))?;
  }

  if dirty.is_empty() {
    return Ok(bundle_graph);
  }

  let cache = papaya::HashMap::new();

  std::thread::scope(|scope| -> Result<(), DiagnosticList> {
    let writer_count = dirty.len().min(OUTPUT_WRITER_THREADS);
    let (sender, receiver) = bounded::<(Arc<dyn Content>, PathId)>(writer_count * 2);
    let mut writers = Vec::with_capacity(writer_count);

    for _ in 0..writer_count {
      let receiver = receiver.clone();
      let output_fs = &options.output_fs;
      writers.push(scope.spawn(move || -> Result<(), DiagnosticList> {
        while let Ok((content, path)) = receiver.recv() {
          if let Err(error) = content.write(&**output_fs, path) {
            return Err(error.into());
          }
        }

        Ok(())
      }));
    }
    drop(receiver);

    let package_result = bundle_graph.bundles.par_iter().enumerate().try_for_each(
      |(bundle_index, bundle)| -> Result<(), DiagnosticList> {
        if dirty.contains(&bundle_index) {
          let content = get_bundle_content(config, &bundle_graph, bundle_index, options, &cache)?;
          let path = bundle.dist_path();

          if sender.send((content, path)).is_err() {
            return Err(
              Diagnostic::from_message("Output writer pool stopped unexpectedly".into()).into(),
            );
          }
        }
        Ok(())
      },
    );
    drop(sender);

    for writer in writers {
      match writer.join() {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(panic) => std::panic::resume_unwind(panic),
      }
    }

    package_result
  })?;

  Ok(bundle_graph)
}

pub fn build(
  entries: &Vec<String>,
  options: BuildOptions,
  make_factory: Arc<FactoryBuilder>,
) -> Result<BundleGraph<'static>, DiagnosticList> {
  let parcel = Parcel::new(entries, options, make_factory)?;
  parcel.build_owned()
}

pub fn get_bundle_content(
  config: &ParcelConfig,
  bundle_graph: &BundleGraph,
  bundle_index: usize,
  options: &ParcelOptions,
  cache: &papaya::HashMap<usize, Arc<Mutex<Option<Arc<dyn Content>>>>>,
) -> Result<Arc<dyn Content>, DiagnosticList> {
  let bundle = &bundle_graph.bundles[bundle_index];

  // If this is an inline bundle, it's possible that it's inlined into many parent bundles.
  // To avoid packaging the same bundle many times, we have a cache by bundle index.
  // Each entry is a Mutex<Option<dyn Content>>. The mutex is initially empty, and locked
  // while the content is packaging. If the bundle is requested a second time concurrently,
  // that thread waits on the lock and reuses the same content.
  let slot = if bundle.bundle_behavior == BundleBehavior::Inline {
    Some(
      cache
        .pin()
        .get_or_insert_with(bundle_index, || Arc::new(Mutex::new(None)))
        .clone(),
    )
  } else {
    None
  };

  // TODO: error instead of deadlocking if there is a cycle in inline bundles. Currently this cannot happen.
  let mut lock = slot.as_ref().map(|slot| slot.lock().unwrap());
  if let Some(content) = lock.as_ref().and_then(|c| (*c).as_ref()) {
    return Ok(content.clone());
  }

  let first_asset = *bundle.assets.first().ok_or_else(|| {
    Diagnostic::from_message("Cannot package a bundle with no assets".to_string())
  })?;
  let first_content = &bundle_graph.asset_graph.asset(first_asset).content;
  let get_inline_bundle_content =
    |bundle_index| get_bundle_content(config, bundle_graph, bundle_index, options, cache);

  let mut content =
    first_content.package(&bundle_graph, &bundle, &get_inline_bundle_content, options)?;

  let mut pipeline = None;
  if let Some(main) = bundle.main_entry_asset {
    pipeline = bundle_graph.asset_graph.asset(main).pipeline.clone();
  }
  // Match optimizer globs against the dist-relative name, as they were written for bundle names
  // (e.g. "*.js"), not absolute dist paths.
  let name = bundle.dist_path().relative(&bundle.target.dist_dir);
  let optimizers = config
    .optimizers
    .get(Cow::Borrowed(name.to_str().unwrap()), &pipeline, false);

  for optimizer in optimizers {
    content = optimizer.optimize(&bundle_graph, &bundle, content, options)?;
  }

  if let Some(slot) = &mut lock {
    **slot = Some(content.clone());
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
  // Highest precedence first (first writer wins via or_insert):
  //   .env.{mode}.local > .env.local > .env.{mode} > .env
  let mut files: Vec<String> = Vec::new();
  if let Some(node_env) = env.get("NODE_ENV").cloned() {
    files.push(format!(".env.{}.local", node_env));
    files.push(".env.local".to_string());
    files.push(format!(".env.{}", node_env));
    files.push(".env".to_string());
  } else {
    files.push(".env.local".to_string());
    files.push(".env".to_string());
  }

  for file in &files {
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

#[cfg(test)]
mod tests {
  use super::load_dotenv;
  use crate::{FileSystem, MemoryFileSystem, PathId};
  use std::{collections::HashMap, path::Path};

  #[test]
  fn dotenv_local_overrides_base() {
    let fs = MemoryFileSystem::new();
    fs.mkdir(Path::new("/root")).unwrap();
    fs.write(PathId::new(Path::new("/root/.env")), &b"FOO=base".to_vec())
      .unwrap();
    fs.write(
      PathId::new(Path::new("/root/.env.local")),
      &b"FOO=local".to_vec(),
    )
    .unwrap();

    let mut env = HashMap::new();
    load_dotenv(PathId::new(Path::new("/root")), &fs, &mut env).unwrap();

    assert_eq!(env.get("FOO").map(String::as_str), Some("local"));
  }

  #[test]
  fn dotenv_mode_local_overrides_everything() {
    let fs = MemoryFileSystem::new();
    fs.mkdir(Path::new("/root")).unwrap();
    fs.write(PathId::new(Path::new("/root/.env")), &b"FOO=base".to_vec())
      .unwrap();
    fs.write(
      PathId::new(Path::new("/root/.env.local")),
      &b"FOO=local".to_vec(),
    )
    .unwrap();
    fs.write(
      PathId::new(Path::new("/root/.env.production")),
      &b"FOO=production".to_vec(),
    )
    .unwrap();
    fs.write(
      PathId::new(Path::new("/root/.env.production.local")),
      &b"FOO=production-local".to_vec(),
    )
    .unwrap();

    let mut env = HashMap::new();
    env.insert("NODE_ENV".to_string(), "production".to_string());
    load_dotenv(PathId::new(Path::new("/root")), &fs, &mut env).unwrap();

    assert_eq!(env.get("FOO").map(String::as_str), Some("production-local"));
  }
}
