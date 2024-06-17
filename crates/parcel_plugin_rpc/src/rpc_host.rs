use std::sync::Arc;

use anyhow;

pub type RpcHostRef = Arc<dyn RpcHost>;
pub type RpcConnectionRef = Arc<dyn RpcWorker>;

pub trait RpcHost: Send + Sync {
  fn ping(&self) -> anyhow::Result<()>;
  fn start(&self) -> anyhow::Result<RpcConnectionRef>;
}

pub trait RpcWorker: Send + Sync {
  fn ping(&self) -> anyhow::Result<()>;
}
