use std::sync::Arc;

use anyhow;
use parcel_filesystem::os_file_system::OsFileSystem;
use parcel_filesystem::FileSystemRef;
use parcel_package_manager::NodePackageManager;
use parcel_plugin_rpc::RpcConnectionRef;
use parcel_plugin_rpc::RpcHostRef;

pub struct Parcel {
  pub fs: FileSystemRef,
  pub rpc: Option<RpcHostRef>,
}

pub struct ParcelOptions {
  pub fs: Option<FileSystemRef>,
  pub rpc: Option<RpcHostRef>,
}

impl Parcel {
  pub fn new(options: ParcelOptions) -> Self {
    let fs = options
      .fs
      .unwrap_or_else(|| Arc::new(OsFileSystem::default()));

    let _node_package_manager = NodePackageManager::new("project_root", fs.clone());

    Self {
      fs,
      rpc: options.rpc,
    }
  }

  pub fn build(&self) -> anyhow::Result<()> {
    let mut _rpc_connection = None::<RpcConnectionRef>;

    if let Some(rpc_host) = &self.rpc {
      _rpc_connection = Some(rpc_host.start()?);
    }

    Ok(())
  }
}
