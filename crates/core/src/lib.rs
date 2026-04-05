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
mod environment;
mod fs;
mod location;
mod namer;
mod optimizer;
mod options;
mod packager;
mod plugin_abi;
mod request;
mod resolver;
mod target;
mod transformer;

use std::{
  collections::HashMap,
  path::{Path, PathBuf},
  sync::Arc,
};

use rayon::iter::{IndexedParallelIterator, IntoParallelRefIterator, ParallelIterator};

use crate::{asset_graph::build_asset_graph, packager::RawPackager};

pub use asset::*;
pub use asset_graph::{AssetGraph, AssetNode};
pub use bundle::*;
pub use bundle_graph::*;
pub use bundler::*;
pub use config::*;
pub use content::*;
pub use dependency::*;
pub use diagnostic::*;
pub use entry::*;
pub use environment::*;
pub use fs::*;
pub use location::*;
pub use namer::*;
pub use optimizer::Optimizer;
pub use options::*;
pub use packager::Packager;
pub use plugin_abi::{CPlugin /*WasmPlugin*/};
pub use resolver::Resolver;
pub use target::*;
pub use transformer::Transformer;

pub fn build(
  entries: Vec<String>,
  options: BuildOptions,
  factory: &dyn PluginFactory,
) -> Result<BundleGraph, DiagnosticList> {
  // Resolve entries.
  let entries = resolve_entries(entries, &options)?;

  let project_root = find_project_root(&entries);
  let mut env = options.env;
  load_dotenv(&project_root, &*options.input_fs, &mut env)?;
  let options = Arc::new(ParcelOptions {
    env,
    mode: options.mode,
    log_level: options.log_level,
    project_root: SourceUrl::from_path(&project_root).unwrap(),
    input_fs: options.input_fs,
    output_fs: options.output_fs,
  });

  let config = Arc::new(ParcelConfig::read(
    &*options.input_fs,
    // &project_root.join(".parcelrc"),
    Path::new("/Users/devongovett/dev/parcel/test/library/.parcelrc"),
    factory,
  ));

  // Build asset graph.
  let asset_graph = build_asset_graph(entries, config.clone(), options.clone())?;

  // Group assets into bundles.
  let bundle_graph = bundle(asset_graph, &config, &*options)?;

  // for i in 0..bundle_graph.bundles.len() {
  bundle_graph.bundles.par_iter().for_each(|bundle| {
    let content = get_bundle_content(&config, &bundle_graph, &bundle).unwrap();

    // TODO: replace hash references

    let name = bundle.name.as_ref().unwrap();
    let dist_dir = bundle.target.dist_dir.to_file_path().unwrap();
    let path = dist_dir.join(name);
    // println!("{:?}", path);
    options
      .output_fs
      .create_dir_all(&path.parent().unwrap())
      .unwrap();
    content.write(&*options.output_fs, &path);
  });

  Ok(bundle_graph)
}

fn get_bundle_content(
  config: &ParcelConfig,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
) -> Result<Arc<dyn Content>, DiagnosticList> {
  let raw = RawPackager {};
  let packager = config
    .packagers
    .get(bundle.ty.extension())
    .map_or_else(|| &raw as &dyn Packager, |p| &**p);
  let get_inline_bundle_content =
    |bundle_index| get_bundle_content(config, bundle_graph, &bundle_graph.bundles[bundle_index]);

  let mut content = packager.package(&bundle_graph, &bundle, &get_inline_bundle_content)?;

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

fn common_root_path<'a>(paths: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
  let mut path_iter = paths.into_iter();
  let mut root = path_iter.next()?.to_path_buf();

  for path in path_iter {
    let mut new_root = PathBuf::new();
    let mut found = false;
    for (a, b) in root.components().zip(path.components()) {
      if a == b {
        found = true;
        new_root.push(a);
      } else {
        break;
      }
    }
    root = new_root;
    if !found {
      return None;
    }
  }

  Some(root)
}

fn find_project_root(entries: &Vec<Entry>) -> PathBuf {
  let root = common_root_path(entries.iter().map(|e| e.url.to_file_path().unwrap()))
    .unwrap_or_else(|| std::env::current_dir().unwrap());

  for dir in root.ancestors() {
    for file in &[
      "yarn.lock",
      "package-lock.json",
      "pnpm-lock.yaml",
      ".git",
      ".hg",
    ] {
      let p = dir.join(file);
      if p.exists() {
        return dir.to_path_buf();
      }
    }
  }

  std::env::current_dir().unwrap()
}

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
