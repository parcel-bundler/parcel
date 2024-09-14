use std::{
  io::Result,
  path::{Path, PathBuf},
};

#[cfg(not(target_arch = "wasm32"))]
use crate::path::canonicalize;
use dashmap::DashMap;

pub trait FileSystem: Send + Sync {
  fn canonicalize(&self, path: &Path, cache: &FileSystemRealPathCache) -> Result<PathBuf>;
  fn read_to_string(&self, path: &Path) -> Result<String>;
  fn is_file(&self, path: &Path) -> bool;
  fn is_dir(&self, path: &Path) -> bool;
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub struct OsFileSystem;

pub type FileSystemRealPathCache =
  DashMap<PathBuf, Option<PathBuf>, xxhash_rust::xxh3::Xxh3Builder>;

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
}
