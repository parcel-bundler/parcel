use parcel_config::PluginNode;
use parcel_core::plugin::OptimizeContext;
use parcel_core::plugin::OptimizedBundle;
use parcel_core::plugin::OptimizerPlugin;
use parcel_core::plugin::PluginContext;

#[derive(Debug)]
pub struct RpcOptimizerPlugin {
  name: String,
}

impl RpcOptimizerPlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcOptimizerPlugin {
      name: plugin.package_name.clone(),
    })
  }
}

impl OptimizerPlugin for RpcOptimizerPlugin {
  fn optimize(&self, ctx: OptimizeContext) -> Result<OptimizedBundle, anyhow::Error> {
    todo!()
  }
}
