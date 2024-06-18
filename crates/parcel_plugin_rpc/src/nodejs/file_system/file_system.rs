use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parcel_core::types::FileSystem;

use crate::nodejs::RpcHostNodejs;

pub struct RpcFileSystemNodejs {
  rpc_host: Arc<RpcHostNodejs>,
}

impl RpcFileSystemNodejs {
  pub fn new(rpc_host: Arc<RpcHostNodejs>) -> Self {
    Self { rpc_host }
  }
}

impl FileSystem for RpcFileSystemNodejs {
  fn read_to_string(&self, path: &Path) -> io::Result<String> {
    match self
      .rpc_host
      .send::<PathBuf, String>("fs/read_to_string", path.to_path_buf())
    {
      Ok(value) => Ok(value),
      Err(error) => Err(io::Error::other(error)),
    }
  }

  fn is_file(&self, path: &Path) -> bool {
    match self
      .rpc_host
      .send::<PathBuf, bool>("fs/is_file", path.to_path_buf())
    {
      Ok(value) => value,
      // TODO we need to return a Result from the FileSystem Trait
      Err(error) => todo!("Error: {}", error),
    }
  }

  fn is_dir(&self, path: &Path) -> bool {
    match self
      .rpc_host
      .send::<PathBuf, bool>("fs/is_dir", path.to_path_buf())
    {
      Ok(value) => value,
      // TODO we need to return a Result from the FileSystem Trait
      Err(error) => todo!("Error: {}", error),
    }
  }
}
