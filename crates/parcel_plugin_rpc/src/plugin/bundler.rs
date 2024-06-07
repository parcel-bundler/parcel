use parcel_config::PluginNode;
use parcel_core::bundle_graph::BundleGraph;
use parcel_core::plugin::BundlerPlugin;
use parcel_core::plugin::PluginContext;

#[derive(Debug)]
pub struct RpcBundlerPlugin {
  name: String,
}

impl RpcBundlerPlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcBundlerPlugin {
      name: plugin.package_name.clone(),
    })
  }
}

impl BundlerPlugin for RpcBundlerPlugin {
  fn bundle(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
    todo!()
  }

  fn optimize(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
    todo!()
  }
}
