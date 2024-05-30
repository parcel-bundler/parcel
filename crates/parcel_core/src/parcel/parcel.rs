use std::sync::Arc;

use parcel_filesystem::os_file_system::OsFileSystem;
use parcel_filesystem::FileSystem;

// TODO eventual public API for Parcel
pub struct Parcel {
  _fs: Arc<dyn FileSystem>,
}

pub struct ParcelOptions {
  fs: Option<Arc<dyn FileSystem>>,
}

impl Parcel {
  pub fn new(options: ParcelOptions) -> Self {
    let fs = options
      .fs
      .unwrap_or_else(|| Arc::new(OsFileSystem::default()));

    Self { _fs: fs }
  }
}

pub struct BuildOptions {}

pub struct BuildResult {
  pub asset_graph: (),
}

impl Parcel {
  pub fn build(_options: BuildOptions) -> Result<BuildResult, anyhow::Error> {
    todo!();
  }
}

impl Parcel {
  pub fn run() {
    todo!();
  }

  pub fn watch() {
    todo!();
  }
}
