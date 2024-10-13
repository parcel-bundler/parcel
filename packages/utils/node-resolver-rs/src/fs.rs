use std::{
  ffi::OsString,
  io::Result,
  path::{Path, PathBuf},
};

#[cfg(not(target_arch = "wasm32"))]
use crate::path::canonicalize;
use bitflags::bitflags;
use dashmap::DashMap;

bitflags! {
  pub struct FileKind: u8 {
    const IS_FILE = 1 << 0;
    const IS_DIR = 1 << 1;
    const IS_SYMLINK = 1 << 2;
  }
}

pub trait FileSystem: Send + Sync {
  fn canonicalize(&self, path: &Path, cache: &FileSystemRealPathCache) -> Result<PathBuf>;
  fn read_to_string(&self, path: &Path) -> Result<String>;
  fn is_file(&self, path: &Path) -> bool;
  fn is_dir(&self, path: &Path) -> bool;
  fn kind(&self, path: &Path) -> FileKind;
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub struct OsFileSystem;

pub type FileSystemRealPathCache =
  DashMap<OsString, Option<OsString>, xxhash_rust::xxh3::Xxh3Builder>;

#[cfg(not(target_arch = "wasm32"))]
impl FileSystem for OsFileSystem {
  fn canonicalize(&self, path: &Path, cache: &FileSystemRealPathCache) -> Result<PathBuf> {
    canonicalize(path, cache)
  }

  fn read_to_string(&self, path: &Path) -> Result<String> {
    std::fs::read_to_string(path)
  }

  fn is_file(&self, path: &Path) -> bool {
    path.is_file()
  }

  fn is_dir(&self, path: &Path) -> bool {
    path.is_dir()
  }

  fn kind(&self, path: &Path) -> FileKind {
    let mut flags = FileKind::empty();
    if let Ok(metadata) = path.metadata() {
      flags.set(FileKind::IS_FILE, metadata.is_file());
      flags.set(FileKind::IS_DIR, metadata.is_dir());
      flags.set(FileKind::IS_SYMLINK, metadata.is_symlink());
    }
    flags
  }
}
