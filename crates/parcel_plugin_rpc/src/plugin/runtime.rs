use std::fmt;
use std::fmt::Debug;

use parcel_config::PluginNode;
use parcel_core::bundle_graph::BundleGraph;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::RuntimeAsset;
use parcel_core::plugin::RuntimePlugin;
use parcel_core::types::Bundle;

pub struct RpcRuntimePlugin {
  _name: String,
}

impl Debug for RpcRuntimePlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcRuntimePlugin")
  }
}

impl RpcRuntimePlugin {
  pub fn new(_ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcRuntimePlugin {
      _name: plugin.package_name.clone(),
    })
  }
}

impl RuntimePlugin for RpcRuntimePlugin {
  fn apply(
    &self,
    _bundle: Bundle,
    _bundle_graph: BundleGraph,
  ) -> Result<Option<Vec<RuntimeAsset>>, anyhow::Error> {
    todo!()
  }
}
