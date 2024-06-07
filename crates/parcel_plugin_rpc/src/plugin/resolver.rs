use std::fmt;
use std::fmt::Debug;

use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::Resolution;
use parcel_core::plugin::ResolveContext;
use parcel_core::plugin::ResolverPlugin;

pub struct RpcResolverPlugin {}

impl Debug for RpcResolverPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcResolverPlugin")
  }
}

impl RpcResolverPlugin {
  pub fn new(_ctx: &PluginContext, _plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcResolverPlugin {})
  }
}

impl ResolverPlugin for RpcResolverPlugin {
  fn resolve(&self, _ctx: &ResolveContext) -> Result<Resolution, anyhow::Error> {
    todo!()
  }
}
