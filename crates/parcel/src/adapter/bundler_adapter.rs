use std::sync::Arc;

use parcel_config::PluginNode;
use parcel_core::bundle_graph::BundleGraph;
use parcel_core::plugin::BundlerPlugin;
use parcel_core::plugin::PluginContext;

use super::Adapter;

#[derive(Debug)]
pub struct BundlerAdapter {
  name: String,
}

impl BundlerAdapter {
  pub fn new(
    adapter: Arc<dyn Adapter>,
    ctx: &PluginContext,
    plugin: &PluginNode,
  ) -> Result<Self, anyhow::Error> {
    Ok(BundlerAdapter {
      name: plugin.package_name.clone(),
    })
  }
}

impl BundlerPlugin for BundlerAdapter {
  fn bundle(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
    todo!()
  }

  fn optimize(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
    todo!()
  }
}
