use std::sync::Arc;

use parcel_filesystem::os_file_system::OsFileSystem;
use parcel_filesystem::FileSystem;

pub type FileSystemRef = Arc<dyn FileSystem + Send + Sync>;

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

    Self { fs }
  }
}
