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
pub use resolver::Resolver;
pub use target::*;
pub use transformer::Transformer;

pub struct Parcel {
  asset_graph_builder: AssetGraphBuilder,
  config: Arc<ParcelConfig>,
  options: Arc<ParcelOptions>,
  /// Metadata from the previous bundle pass used to detect which bundles need re-packaging.
  /// Keyed by bundle name; value is (sorted asset indices, dist path).
  prev_bundles: HashMap<String, (Vec<usize>, PathBuf)>,
}

impl Parcel {
  pub fn new(
    entries: &Vec<String>,
    options: BuildOptions,
    factory: &dyn PluginFactory,
  ) -> Result<Parcel, DiagnosticList> {
    let (entries, project_root) = resolve_entries(&entries, &options)?;

    let mut env = options.env;
    load_dotenv(&project_root, &*options.input_fs, &mut env)?;

    let config_file = options
      .config
      .map(|c| options.cwd.join(c))
      .unwrap_or_else(|| project_root.join(".parcelrc"));
    let config = Arc::new(
      if options
        .input_fs
        .kind(&config_file)
        .contains(FileKind::IS_FILE)
      {
        ParcelConfig::read(&*options.input_fs, &config_file, factory)?
      } else {
        factory.config("@parcel/config-default", &config_file)?
      },
    );

    let options = Arc::new(ParcelOptions {
      env,
      mode: options.mode,
      log_level: options.log_level,
      project_root: SourceUrl::from_absolute_directory_path(&project_root)?,
      input_fs: options.input_fs,
      output_fs: options.output_fs,
      cwd: options.cwd,
    });

    Ok(Parcel {
      asset_graph_builder: AssetGraphBuilder::new(entries, config.clone(), options.clone()),
      config,
      options,
      prev_bundles: HashMap::new(),
    })
  }

  pub fn project_root(&self) -> &SourceUrl {
    &self.options.project_root
  }

  pub fn invalidate(&mut self, changed: &[SourceUrl]) -> HashSet<usize> {
    self.asset_graph_builder.invalidate(changed)
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
    let mut new_prev: HashMap<String, (Vec<usize>, PathBuf)> = HashMap::new();
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
        self.options.output_fs.remove_file(dist_path).ok();
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
          content.write(&*opts.output_fs, &path).ok();
        }
      });

    Ok(bundle_graph)
  }
}

pub fn build(
  entries: &Vec<String>,
  options: BuildOptions,
  factory: &dyn PluginFactory,
) -> Result<BundleGraph, DiagnosticList> {
  let mut parcel = Parcel::new(entries, options, factory)?;
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
  project_root: &Path,
  fs: &dyn FileSystem,
  env: &mut HashMap<String, String>,
) -> Result<(), DiagnosticList> {
  if let Some(node_env) = env.get("NODE_ENV").cloned() {
    for file in ["", ".local"] {
      let path = project_root.join(format!(".env.{}{}", node_env, file));
      if fs.kind(&path) == FileKind::IS_FILE {
        let content = fs.read(&path)?;
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
    let path = project_root.join(file);
    if fs.kind(&path) == FileKind::IS_FILE {
      let content = fs.read(&path)?;
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
