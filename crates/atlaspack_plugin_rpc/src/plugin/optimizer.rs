use std::fmt;
use std::fmt::Debug;

use atlaspack_config::PluginNode;
use atlaspack_core::plugin::OptimizeContext;
use atlaspack_core::plugin::OptimizedBundle;
use atlaspack_core::plugin::OptimizerPlugin;
use atlaspack_core::plugin::PluginContext;

pub struct RpcOptimizerPlugin {
  _name: String,
}

impl Debug for RpcOptimizerPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcOptimizerPlugin")
  }
}

impl RpcOptimizerPlugin {
  pub fn new(_ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcOptimizerPlugin {
      _name: plugin.package_name.clone(),
    })
  }
}

impl OptimizerPlugin for RpcOptimizerPlugin {
  fn optimize(&self, _ctx: OptimizeContext) -> Result<OptimizedBundle, anyhow::Error> {
    todo!()
  }
}
