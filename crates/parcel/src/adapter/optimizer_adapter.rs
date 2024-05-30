use std::sync::Arc;

use parcel_config::PluginNode;
use parcel_core::plugin::OptimizeContext;
use parcel_core::plugin::OptimizedBundle;
use parcel_core::plugin::OptimizerPlugin;
use parcel_core::plugin::PluginContext;

use super::Adapter;

#[derive(Debug)]
pub struct OptimizerAdapter {
  name: String,
}

impl OptimizerAdapter {
  pub fn new(
    adapter: Arc<dyn Adapter>,
    ctx: &PluginContext,
    plugin: &PluginNode,
  ) -> Result<Self, anyhow::Error> {
    Ok(OptimizerAdapter {
      name: plugin.package_name.clone(),
    })
  }
}

impl OptimizerPlugin for OptimizerAdapter {
  fn optimize(&self, ctx: OptimizeContext) -> Result<OptimizedBundle, anyhow::Error> {
    todo!()
  }
}
