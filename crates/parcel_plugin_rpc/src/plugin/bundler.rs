use std::fmt;
use std::fmt::Debug;

use parcel_config::PluginNode;
use parcel_core::bundle_graph::BundleGraph;
use parcel_core::plugin::BundlerPlugin;
use parcel_core::plugin::PluginContext;

pub struct RpcBundlerPlugin {
  _name: String,
}

impl Debug for RpcBundlerPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcBundlerPlugin")
  }
}

impl RpcBundlerPlugin {
  pub fn new(_ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcBundlerPlugin {
      _name: plugin.package_name.clone(),
    })
  }
}

impl BundlerPlugin for RpcBundlerPlugin {
  fn bundle(&self, _bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
    todo!()
  }

  fn optimize(&self, _bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
    todo!()
  }
}
