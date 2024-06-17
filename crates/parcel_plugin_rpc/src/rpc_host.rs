use std::{path::Path, sync::Arc};

use anyhow;

pub type RpcHostRef = Arc<dyn RpcHost>;
pub type RpcConnectionRef = Arc<dyn RpcConnection>;

pub trait RpcHost: Send + Sync {
  fn ping(&self) -> anyhow::Result<()>;
  fn start(&self) -> anyhow::Result<RpcConnectionRef>;
  fn fs_read_to_string(&self, path: &Path) -> anyhow::Result<String>;
  fn fs_is_file(&self, path: &Path) -> anyhow::Result<bool>;
  fn fs_is_dir(&self, path: &Path) -> anyhow::Result<bool>;
}

pub trait RpcConnection: Send + Sync {
  fn ping(&self) -> anyhow::Result<()>;
}
