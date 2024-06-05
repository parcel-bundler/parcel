use std::sync::Arc;

use parcel_filesystem::os_file_system::OsFileSystem;
use parcel_filesystem::FileSystemRef;
use parcel_package_manager::NodePackageManager;

pub struct Parcel {
  pub fs: FileSystemRef,
}

pub struct ParcelOptions {
  pub fs: Option<FileSystemRef>,
}

impl Parcel {
  pub fn new(options: ParcelOptions) -> Self {
    let fs = options
      .fs
      .unwrap_or_else(|| Arc::new(OsFileSystem::default()));
    let _node_package_manager = NodePackageManager::new("project_root", fs.clone());

    Self { fs }
  }
}
