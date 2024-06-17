use parcel_core::cache::Cache;

use crate::RpcHostRef;

pub struct RpcCache {
  rpc_host: RpcHostRef,
}

impl RpcCache {
  pub fn new(rpc_host: RpcHostRef) -> Self {
    Self { rpc_host }
  }
}

impl Cache for RpcCache {
  fn set_blob(&self, key: &str, blob: &str) -> anyhow::Result<()> {
    self.rpc_host.cache_set_blob(key, blob)
  }
}
