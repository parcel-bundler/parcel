use std::{io, path::Path};

use parcel_core::types::FileSystem;

use crate::RpcHostRef;

pub struct RpcFileSystem {
  rpc_host: RpcHostRef,
}

impl RpcFileSystem {
  pub fn new(rpc_host: RpcHostRef) -> Self {
    Self { rpc_host }
  }
}

impl FileSystem for RpcFileSystem {
  fn read_to_string(&self, path: &Path) -> io::Result<String> {
    match self.rpc_host.fs_read_to_string(path) {
      Ok(result) => Ok(result),
      Err(err) => {
        if err.is::<io::Error>() {
          Err(err.downcast().unwrap())
        } else {
          Err(io::Error::other(err))
        }
      }
    }
  }

  fn is_file(&self, path: &Path) -> bool {
    self
      .rpc_host
      .fs_is_file(path)
      .expect("Un expected panic in RPC FS operation")
  }

  fn is_dir(&self, path: &Path) -> bool {
    self
      .rpc_host
      .fs_is_dir(path)
      .expect("Un expected panic in RPC FS operation")
  }
}
