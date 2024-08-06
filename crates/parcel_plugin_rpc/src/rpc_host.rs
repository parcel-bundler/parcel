use std::{path::PathBuf, sync::Arc};

pub type RpcHostRef = Arc<dyn RpcHost>;
pub type RpcWorkerRef = Arc<dyn RpcWorker>;

pub trait RpcHost: Send + Sync {
  fn start(&self) -> anyhow::Result<RpcWorkerRef>;
}

pub trait RpcWorker: Send + Sync {
  fn ping(&self) -> anyhow::Result<()>;
  fn load_resolver(&self, resolve_from: PathBuf, specifier: String) -> anyhow::Result<String>;
}
