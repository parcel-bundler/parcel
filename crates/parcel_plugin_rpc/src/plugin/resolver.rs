use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::Resolution;
use parcel_core::plugin::ResolveContext;
use parcel_core::plugin::ResolverPlugin;

#[derive(Debug)]
pub struct PluginResolverRpc {}

impl PluginResolverRpc {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(PluginResolverRpc {})
  }
}

impl ResolverPlugin for PluginResolverRpc {
  fn resolve(&self, ctx: &ResolveContext) -> Result<Resolution, anyhow::Error> {
    todo!()
  }
}
