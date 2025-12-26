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
mod request;
mod resolver;
mod target;
mod transformer;

use std::sync::Arc;

use crate::asset_graph::build_asset_graph;

pub use asset::*;
pub use asset_graph::AssetGraph;
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
pub use options::*;
pub use packager::Packager;
pub use resolver::Resolver;
pub use target::*;
pub use transformer::Transformer;

pub fn build(
  entries: Vec<String>,
  config: Arc<ParcelConfig>,
  options: Arc<ParcelOptions>,
) -> Result<(), Vec<Diagnostic>> {
  // Resolve entries.
  let entries = resolve_entries(entries);

  // Build asset graph.
  let asset_graph = build_asset_graph(entries, config.clone(), options.clone())?;

  // Group assets into bundles.
  let bundle_graph = bundle(asset_graph, &config)?;

  for i in 0..bundle_graph.bundles.len() {
    let content = get_bundle_content(&config, &bundle_graph, &bundle_graph.bundles[i])?;

    // TODO: replace hash references

    let name = bundle_graph.bundles[i].name.as_ref().unwrap();
    content
      .write(&*options.input_fs, name)
      .map_err(|e| vec![e.into()])?;
  }

  Ok(())
}

fn get_bundle_content(
  config: &ParcelConfig,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
) -> Result<Arc<dyn Content>, Vec<Diagnostic>> {
  let packager = config.packagers.get(bundle.ty.extension()).unwrap();
  let get_inline_bundle_content =
    |bundle_index| get_bundle_content(config, bundle_graph, &bundle_graph.bundles[bundle_index]);

  let mut content = packager
    .plugin
    .package(&bundle_graph, &bundle, &get_inline_bundle_content)?;

  let optimizers = config.optimizers.get::<&str>(
    bundle.name.as_ref().unwrap().as_path().to_str().unwrap(),
    &None,
    false,
  );

  for optimizer in optimizers {
    content = optimizer.plugin.optimize(&bundle_graph, &bundle, content)?;
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
