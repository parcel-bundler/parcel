use parcel_config::PluginNode;
use parcel_core::bundle_graph::BundleGraph;
use parcel_core::plugin::NamerPlugin;
use parcel_core::plugin::PluginContext;
use parcel_core::types::Bundle;

#[derive(Debug)]
pub struct RpcNamerPlugin {
  name: String,
}

impl RpcNamerPlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcNamerPlugin {
      name: plugin.package_name.clone(),
    })
  }
}

impl NamerPlugin for RpcNamerPlugin {
  fn name(
    &self,
    bundle: &Bundle,
    bundle_graph: &BundleGraph,
  ) -> Result<Option<std::path::PathBuf>, anyhow::Error> {
    todo!()
  }
}
