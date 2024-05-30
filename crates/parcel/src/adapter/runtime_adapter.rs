use std::sync::Arc;

use parcel_config::PluginNode;
use parcel_core::bundle_graph::BundleGraph;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::RuntimeAsset;
use parcel_core::plugin::RuntimePlugin;
use parcel_core::types::Bundle;

use super::Adapter;

#[derive(Debug)]
pub struct RuntimeAdapter {
  name: String,
}

impl RuntimeAdapter {
  pub fn new(
    adapter: Arc<dyn Adapter>,
    ctx: &PluginContext,
    plugin: &PluginNode,
  ) -> Result<Self, anyhow::Error> {
    Ok(RuntimeAdapter {
      name: plugin.package_name.clone(),
    })
  }
}

impl RuntimePlugin for RuntimeAdapter {
  fn apply(
    &self,
    bundle: Bundle,
    bundle_graph: BundleGraph,
  ) -> Result<Option<Vec<RuntimeAsset>>, anyhow::Error> {
    todo!()
  }
}
