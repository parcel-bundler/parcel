use std::fmt;
use std::fmt::Debug;

use atlaspack_config::PluginNode;
use atlaspack_core::bundle_graph::BundleGraph;
use atlaspack_core::plugin::NamerPlugin;
use atlaspack_core::plugin::PluginContext;
use atlaspack_core::types::Bundle;

pub struct RpcNamerPlugin {
  _name: String,
}

impl Debug for RpcNamerPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcNamerPlugin")
  }
}

impl RpcNamerPlugin {
  pub fn new(_ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcNamerPlugin {
      _name: plugin.package_name.clone(),
    })
  }
}

impl NamerPlugin for RpcNamerPlugin {
  fn name(
    &self,
    _bundle: &Bundle,
    _bundle_graph: &BundleGraph,
  ) -> Result<Option<std::path::PathBuf>, anyhow::Error> {
    todo!()
  }
}
