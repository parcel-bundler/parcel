use std::{
  io::Result,
  path::{Path, PathBuf},
};

use bitflags::bitflags;

bitflags! {
  pub struct FileKind: u8 {
    const IS_FILE = 1 << 0;
    const IS_DIR = 1 << 1;
    const IS_SYMLINK = 1 << 2;
  }
}

pub trait FileSystem: Send + Sync {
  fn read_to_string(&self, path: &Path) -> Result<String>;
  fn kind(&self, path: &Path) -> FileKind;
  fn read_link(&self, path: &Path) -> Result<PathBuf>;
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub struct OsFileSystem;

#[cfg(not(target_arch = "wasm32"))]
impl FileSystem for OsFileSystem {
  fn read_to_string(&self, path: &Path) -> Result<String> {
    std::fs::read_to_string(path)
  }

  fn kind(&self, path: &Path) -> FileKind {
    let mut flags = FileKind::empty();

    // A majority of paths are not symlinks. symlink_metadata will tell us whether a path is a symlink,
    // and if not, also whether the path is a file or directory. If it was a symlink we'll need to make
    // another call to get the metadata of the underlying path, but this is rare.
    if let Ok(metadata) = path.symlink_metadata() {
      if metadata.is_symlink() {
        flags.set(FileKind::IS_SYMLINK, true);
        if let Ok(metadata) = path.metadata() {
          flags.set(FileKind::IS_FILE, metadata.is_file());
          flags.set(FileKind::IS_DIR, metadata.is_dir());
        }
      } else {
        flags.set(FileKind::IS_FILE, metadata.is_file());
        flags.set(FileKind::IS_DIR, metadata.is_dir());
      }
    }

    flags
  }

  fn read_link(&self, path: &Path) -> Result<PathBuf> {
    path.read_link()
  }
}
