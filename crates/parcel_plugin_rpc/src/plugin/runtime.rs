use parcel_config::PluginNode;
use parcel_core::bundle_graph::BundleGraph;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::RuntimeAsset;
use parcel_core::plugin::RuntimePlugin;
use parcel_core::types::Bundle;

#[derive(Debug)]
pub struct RpcRuntimePlugin {
  name: String,
}

impl RpcRuntimePlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcRuntimePlugin {
      name: plugin.package_name.clone(),
    })
  }
}

impl RuntimePlugin for RpcRuntimePlugin {
  fn apply(
    &self,
    bundle: Bundle,
    bundle_graph: BundleGraph,
  ) -> Result<Option<Vec<RuntimeAsset>>, anyhow::Error> {
    todo!()
  }
}
