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
mod packaging;
mod path;
mod reporter;
mod request;
mod resolver;
mod target;
mod transformer;

use std::{
  collections::{HashMap, HashSet},
  path::Path,
  sync::{Arc, atomic::Ordering},
};

use crossbeam_channel::bounded;

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
pub use packaging::{InlineBundleCache, get_bundle_content};
use packaging::{Packaged, PrevBundle};
pub use path::{PathId, SubPath};
pub use reporter::*;
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
  /// Keyed by the bundle's template dist path.
  prev_bundles: HashMap<PathId, PrevBundle>,
  /// As `prev_bundles`, for inline bundles (which have no dist path), keyed by bundle id.
  /// A dirty inline bundle re-packages every bundle its content is embedded in.
  prev_inline_bundles: HashMap<u64, Vec<AssetIndex>>,
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
  /// True when the set of bundle output paths changed compared with the previous build.
  pub output_paths_changed: bool,
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
        // Deleting an entry is a config-level change, not an incremental one: glob entries
        // must be re-globbed so the entry disappears from the build, and deleting a file
        // entry fails the recreate with a clear "entry not found" error while the last good
        // build stays usable.
        config_invalidations
          .on_file_delete
          .entry(url)
          .or_default()
          .push(AssetNodeIndex(0));
      }
    }

    let mut reporters = config.reporters.clone();
    reporters.extend(options.reporters.into_iter());
    let reporters = Reporters::new(reporters, options.log_level.clone());
    let content_hash = options
      .content_hash
      .unwrap_or(options.mode == BuildMode::Production);
    let options = Arc::new(ParcelOptions {
      env,
      mode: options.mode,
      log_level: options.log_level,
      project_root,
      input_fs: cached_fs.clone(),
      output_fs: options.output_fs,
      cwd: options.cwd,
      hmr: options.hmr,
      reporters: reporters.clone(),
      content_hash,
    });

    // Weak, so the options may own the reporters without the two keeping each
    // other alive forever.
    reporters.attach(Arc::downgrade(&options));

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
      prev_inline_bundles: HashMap::new(),
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
    deleted: &[PathId],
  ) -> Result<InvalidateResult, DiagnosticList> {
    if self.is_config_change(changed, created, deleted) {
      // Recreate first; on failure (e.g. an invalid config edit) leave `self` untouched so the
      // last good build remains usable.
      let mut parcel = Parcel::new(
        &self.entries,
        self.build_options.clone(),
        self.make_factory.clone(),
      )?;
      // Keep the previous bundle metadata so the full rebuild still deletes output files whose
      // bundles no longer exist.
      parcel.prev_bundles = std::mem::take(&mut self.prev_bundles);
      parcel.prev_inline_bundles = std::mem::take(&mut self.prev_inline_bundles);
      *self = parcel;
      return Ok(InvalidateResult {
        affected: HashSet::new(),
        config_changed: true,
      });
    }

    let paths: Vec<PathId> = changed
      .iter()
      .chain(created)
      .chain(deleted)
      .copied()
      .collect();
    self.cached_fs.invalidate(paths);

    let affected = self
      .asset_graph_builder
      .invalidate(changed, created, deleted);
    Ok(InvalidateResult {
      affected,
      config_changed: false,
    })
  }

  /// Returns true if any of the changed/created files was read while loading configuration.
  pub fn is_config_change(
    &self,
    changed: &[PathId],
    created: &[PathId],
    deleted: &[PathId],
  ) -> bool {
    !self
      .config_invalidations
      .invalidate(changed, created, deleted)
      .is_empty()
  }

  pub fn build(&mut self) -> Result<BundleGraph<'_>, DiagnosticList> {
    Ok(self.build_with_changes()?.bundle_graph)
  }

  pub fn build_with_changes(&mut self) -> Result<BuildResult<'_>, DiagnosticList> {
    // Cloned up front so the events below borrow nothing from `self`, which the
    // build result holds for as long as it lives.
    let reporters = self.options.reporters.clone();
    reporters.build_start();
    let start = std::time::Instant::now();

    match self.build_uninstrumented() {
      Ok(result) => {
        reporters.build_success(BuildSuccess {
          bundle_graph: &result.bundle_graph,
          changed_assets: &result.changed_assets,
          build_time: start.elapsed(),
        });
        Ok(result)
      }
      Err(error) => {
        reporters.build_failure(&error);
        Err(error)
      }
    }
  }

  /// The build itself, without the reporter events around it.
  fn build_uninstrumented(&mut self) -> Result<BuildResult<'_>, DiagnosticList> {
    let result = self.asset_graph_builder.build_with_changes()?;
    let changed_assets = result.changed_assets;
    let (bundle_graph, output_paths_changed) = bundle_and_package(
      result.asset_graph,
      &self.config,
      &self.options,
      &changed_assets,
      &mut self.prev_bundles,
      &mut self.prev_inline_bundles,
    )?;

    Ok(BuildResult {
      bundle_graph,
      changed_assets,
      output_paths_changed,
    })
  }

  pub fn build_owned(self) -> Result<BundleGraph<'static>, DiagnosticList> {
    let reporters = self.options.reporters.clone();
    reporters.build_start();
    let start = std::time::Instant::now();

    let Parcel {
      asset_graph_builder,
      config,
      options,
      mut prev_bundles,
      mut prev_inline_bundles,
      ..
    } = self;

    let result = match asset_graph_builder.build_owned_with_changes() {
      Ok(result) => result,
      Err(error) => {
        reporters.build_failure(&error);
        return Err(error);
      }
    };

    let (bundle_graph, _) = match bundle_and_package(
      result.asset_graph,
      &config,
      &options,
      &result.changed_assets,
      &mut prev_bundles,
      &mut prev_inline_bundles,
    ) {
      Ok(bundle_graph) => bundle_graph,
      Err(error) => {
        reporters.build_failure(&error);
        return Err(error);
      }
    };

    reporters.build_success(BuildSuccess {
      bundle_graph: &bundle_graph,
      changed_assets: &result.changed_assets,
      build_time: start.elapsed(),
    });

    Ok(bundle_graph)
  }
}

fn bundle_and_package<'a>(
  asset_graph: AssetGraph<'a>,
  config: &ParcelConfig,
  options: &ParcelOptions,
  changed_assets: &Vec<AssetIndex>,
  prev_bundles: &mut HashMap<PathId, PrevBundle>,
  prev_inline_bundles: &mut HashMap<u64, Vec<AssetIndex>>,
) -> Result<(BundleGraph<'a>, bool), DiagnosticList> {
  // Group assets into bundles.
  let bundle_graph = bundle(asset_graph, config, options)?;
  let bundles = &bundle_graph.bundles;

  // Diff the new bundle graph against the previous build's metadata to find dirty bundles.
  // A bundle is dirty if it's new, its asset composition changed, or any of its assets
  // were re-transformed this build. Bundles are tracked by their template path (the namer's
  // output), which is stable across builds, and inline bundles by id since they aren't written.
  let mut new_prev_inline: HashMap<u64, Vec<AssetIndex>> = HashMap::new();
  let mut dirty = vec![false; bundles.len()];
  let mut sorted_assets = Vec::with_capacity(bundles.len());

  for (bundle_index, bundle) in bundles.iter().enumerate() {
    let mut assets = bundle.assets.clone();
    assets.sort_unstable();

    let prev_assets = if bundle.bundle_behavior == BundleBehavior::Inline {
      prev_inline_bundles.get(&bundle.id)
    } else {
      prev_bundles
        .get(&bundle.dist_path.unwrap())
        .map(|prev| &prev.assets)
    };

    dirty[bundle_index] = match prev_assets {
      None => true,
      Some(prev_assets) => {
        *prev_assets != assets || bundle.assets.iter().any(|i| changed_assets.contains(i))
      }
    };

    if bundle.bundle_behavior == BundleBehavior::Inline {
      new_prev_inline.insert(bundle.id, assets.clone());
    }
    sorted_assets.push(assets);
  }

  // An inline bundle's content is embedded in the bundles referencing it rather than written
  // to its own file, so a dirty inline bundle must re-package every bundle that embeds it,
  // transitively (inline bundles can nest).
  let mut inline_embeds: HashMap<AssetIndex, Vec<usize>> = HashMap::new();
  for (asset_index, bundle_index) in bundle_graph.bundle_dependencies() {
    if bundles[bundle_index].bundle_behavior == BundleBehavior::Inline {
      inline_embeds
        .entry(asset_index)
        .or_default()
        .push(bundle_index);
    }
  }
  if !inline_embeds.is_empty() {
    loop {
      let mut changed = false;
      for (bundle_index, bundle) in bundles.iter().enumerate() {
        if dirty[bundle_index] {
          continue;
        }
        let embeds_dirty_inline = bundle.assets.iter().any(|asset| {
          inline_embeds
            .get(asset)
            .is_some_and(|embedded| embedded.iter().any(|&index| dirty[index]))
        });
        if embeds_dirty_inline {
          dirty[bundle_index] = true;
          changed = true;
        }
      }
      if !changed {
        break;
      }
    }
  }

  // Adding or removing bundles can change what other bundles contain (e.g. which bundles a
  // loader loads) without changing their assets, so re-package every bundle. Changes to final
  // names alone are handled while packaging, through declared dependencies.
  let template_paths: HashSet<PathId> = bundles
    .iter()
    .filter(|bundle| bundle.bundle_behavior != BundleBehavior::Inline)
    .map(|bundle| bundle.dist_path.unwrap())
    .collect();
  let output_paths_changed = prev_bundles.len() != template_paths.len()
    || prev_bundles
      .keys()
      .any(|template| !template_paths.contains(template));
  if output_paths_changed {
    dirty.fill(true);
  }

  *prev_inline_bundles = new_prev_inline;

  // The hash of the content that named each bundle, if it was named by its own content.
  let mut content_hashes: Vec<Option<u128>> = vec![None; bundles.len()];
  if dirty
    .iter()
    .zip(bundles)
    .any(|(&dirty, bundle)| dirty && bundle.bundle_behavior != BundleBehavior::Inline)
  {
    // Create each output directory once before packaging starts. Library builds can emit
    // thousands of bundles into a much smaller number of shared directories, so calling
    // create_dir_all for every bundle adds significant filesystem metadata overhead.
    let mut output_dirs = HashSet::new();
    for template in &template_paths {
      let parent = template.parent().ok_or_else(|| {
        Diagnostic::from_message(format!("{:?} has no parent directory", template))
      })?;
      output_dirs.insert(parent);
    }

    for dir in output_dirs {
      options
        .output_fs
        .create_dir_all(dir)
        .map_err(|e| Diagnostic::from_message(format!("Failed to create {:?}: {}", dir, e)))?;
    }

    let packaged = std::thread::scope(|scope| -> Result<Packaged, DiagnosticList> {
      let writer_count = OUTPUT_WRITER_THREADS;
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

      let package_result = packaging::package_bundles(
        config,
        &bundle_graph,
        options,
        &dirty,
        prev_bundles,
        &sender,
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

    let stats = &packaged.stats;
    options.log(
      LogLevel::Verbose,
      format!(
        "Packaged {} bundles ({} second passes); {} naming cycles, largest has {} bundles",
        stats.packaged.load(Ordering::Relaxed),
        stats.second_passes.load(Ordering::Relaxed),
        stats.cycles.load(Ordering::Relaxed),
        stats.largest_cycle.load(Ordering::Relaxed),
      ),
    );
    content_hashes = packaged.content_hashes;
  } else {
    // Nothing changed, so every bundle keeps its previous name.
    for (index, bundle) in bundles.iter().enumerate() {
      if let Some(prev) = prev_bundles.get(&bundle.dist_path.unwrap())
        && bundle.bundle_behavior != BundleBehavior::Inline
        && prev.final_path != bundle.dist_path.unwrap()
      {
        bundle.set_final_path(prev.final_path);
        content_hashes[index] = prev.content_hash;
      }
    }
  }

  // Delete output files (and their sourcemaps) that no bundle writes to anymore.
  let final_paths: HashSet<PathId> = bundles
    .iter()
    .filter(|bundle| bundle.bundle_behavior != BundleBehavior::Inline)
    .map(|bundle| bundle.dist_path())
    .collect();
  for prev in prev_bundles.values() {
    if !final_paths.contains(&prev.final_path) {
      for stale in [prev.final_path, prev.final_path.add_extension("map")] {
        match options.output_fs.remove_file(stale) {
          Ok(()) => {}
          Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
          Err(e) => {
            return Err(
              Diagnostic::from_message(format!("Failed to remove stale {:?}: {}", stale, e)).into(),
            );
          }
        }
      }
    }
  }

  *prev_bundles = bundles
    .iter()
    .zip(sorted_assets)
    .zip(content_hashes)
    .filter(|((bundle, _), _)| bundle.bundle_behavior != BundleBehavior::Inline)
    .map(|((bundle, assets), content_hash)| {
      (
        bundle.dist_path.unwrap(),
        PrevBundle {
          assets,
          final_path: bundle.dist_path(),
          content_hash,
        },
      )
    })
    .collect();

  Ok((bundle_graph, output_paths_changed))
}

pub fn build(
  entries: &Vec<String>,
  options: BuildOptions,
  make_factory: Arc<FactoryBuilder>,
) -> Result<BundleGraph<'static>, DiagnosticList> {
  let parcel = Parcel::new(entries, options, make_factory)?;
  parcel.build_owned()
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
