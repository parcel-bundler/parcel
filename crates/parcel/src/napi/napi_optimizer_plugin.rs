use parcel_config::PluginNode;
use parcel_core::plugin::OptimizeContext;
use parcel_core::plugin::OptimizedBundle;
use parcel_core::plugin::OptimizerPlugin;
use parcel_core::plugin::PluginContext;

#[derive(Debug)]
pub struct NapiOptimizerPlugin {
  name: String,
}

impl NapiOptimizerPlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(NapiOptimizerPlugin {
      name: plugin.package_name.clone(),
    })
  }
}

impl OptimizerPlugin for NapiOptimizerPlugin {
  fn optimize(&self, ctx: OptimizeContext) -> Result<OptimizedBundle, anyhow::Error> {
    todo!()
  }
}
