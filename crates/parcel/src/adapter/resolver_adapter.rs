use std::sync::Arc;

use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::Resolution;
use parcel_core::plugin::ResolveContext;
use parcel_core::plugin::ResolverPlugin;

use super::Adapter;

#[derive(Debug)]
pub struct ResolverAdapter {}

impl ResolverAdapter {
  pub fn new(
    adapter: Arc<dyn Adapter>,
    ctx: &PluginContext,
    plugin: &PluginNode,
  ) -> Result<Self, anyhow::Error> {
    Ok(ResolverAdapter {})
  }
}

impl ResolverPlugin for ResolverAdapter {
  fn resolve(&self, ctx: &ResolveContext) -> Result<Resolution, anyhow::Error> {
    todo!()
  }
}
