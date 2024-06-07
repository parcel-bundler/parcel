use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::Resolution;
use parcel_core::plugin::ResolveContext;
use parcel_core::plugin::ResolverPlugin;

#[derive(Debug)]
pub struct RpcResolverPlugin {}

impl RpcResolverPlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcResolverPlugin {})
  }
}

impl ResolverPlugin for RpcResolverPlugin {
  fn resolve(&self, ctx: &ResolveContext) -> Result<Resolution, anyhow::Error> {
    todo!()
  }
}
