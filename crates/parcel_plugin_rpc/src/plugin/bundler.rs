use parcel_config::PluginNode;
use parcel_core::bundle_graph::BundleGraph;
use parcel_core::plugin::BundlerPlugin;
use parcel_core::plugin::PluginContext;

#[derive(Debug)]
pub struct PluginBundlerRpc {
  name: String,
}

impl PluginBundlerRpc {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(PluginBundlerRpc {
      name: plugin.package_name.clone(),
    })
  }
}

impl BundlerPlugin for PluginBundlerRpc {
  fn bundle(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
    todo!()
  }

  fn optimize(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
    todo!()
  }
}
