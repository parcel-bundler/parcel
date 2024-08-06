use std::fmt;
use std::fmt::Debug;

use parcel_config::PluginNode;
use parcel_core::plugin::ResolveContext;
use parcel_core::plugin::Resolved;
use parcel_core::plugin::ResolverPlugin;

use crate::RpcWorkerRef;

#[derive(Hash)]
pub struct RpcResolverPlugin {
  id: String,
}

impl Debug for RpcResolverPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcResolverPlugin")
  }
}

impl RpcResolverPlugin {
  pub fn new(rpc_worker: &RpcWorkerRef, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    let resolve_from = (*plugin.resolve_from).clone();
    let id = rpc_worker.load_resolver(resolve_from, plugin.package_name.clone())?;
    Ok(RpcResolverPlugin { id })
  }
}

impl ResolverPlugin for RpcResolverPlugin {
  fn resolve(&self, _ctx: ResolveContext) -> Result<Resolved, anyhow::Error> {
    todo!()
  }
}
