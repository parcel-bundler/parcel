use std::sync::Arc;

use anyhow;

pub type RpcHostRef = Arc<dyn RpcHost>;

pub trait RpcHost: Send + Sync {
  fn ping(&self) -> anyhow::Result<()>;
}
