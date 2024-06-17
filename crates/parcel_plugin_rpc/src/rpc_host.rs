use std::sync::Arc;

use anyhow;

pub type RpcHostRef = Arc<dyn RpcHost>;
pub type RpcConnectionRef = Arc<dyn RpcConnection>;

pub trait RpcHost: Send + Sync {
  fn ping(&self) -> anyhow::Result<()>;
  fn cache_set_blob(&self, key: &str, blob: &str) -> anyhow::Result<()>;
  fn start(&self) -> anyhow::Result<RpcConnectionRef>;
}

pub trait RpcConnection: Send + Sync {
  fn ping(&self) -> anyhow::Result<()>;
}
