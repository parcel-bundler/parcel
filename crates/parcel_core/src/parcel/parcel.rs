use std::sync::Arc;

use parcel_filesystem::os_file_system::OsFileSystem;
use parcel_filesystem::FileSystem;

pub struct Parcel {
  pub fs: Arc<dyn FileSystem>,
}

pub struct ParcelOptions {
  pub fs: Option<Arc<dyn FileSystem>>,
}

impl Parcel {
  pub fn new(options: ParcelOptions) -> Self {
    let fs = options
      .fs
      .unwrap_or_else(|| Arc::new(OsFileSystem::default()));

    Self { fs }
  }

  pub fn build(_options: BuildOptions) -> Result<BuildResult, anyhow::Error> {
    todo!();
  }

  pub fn run() {
    todo!();
  }

  pub fn watch() {
    todo!();
  }
}

pub struct BuildOptions {}

pub struct BuildResult {
  pub asset_graph: (),
}
