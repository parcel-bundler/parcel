use std::fmt;
use std::fmt::Debug;

use atlaspack_config::PluginNode;
use atlaspack_core::plugin::PluginContext;
use atlaspack_core::plugin::ResolveContext;
use atlaspack_core::plugin::Resolved;
use atlaspack_core::plugin::ResolverPlugin;

#[derive(Hash)]
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
  fn resolve(&self, _ctx: ResolveContext) -> Result<Resolved, anyhow::Error> {
    todo!()
  }
}
