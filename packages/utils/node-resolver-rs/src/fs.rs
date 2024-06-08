use std::{
  io::Result,
  path::{Path, PathBuf},
  sync::Arc,
};

#[cfg(not(target_arch = "wasm32"))]
use crate::path::canonicalize;
use dashmap::DashMap;
use gxhash::GxBuildHasher;

pub trait FileSystem: Send + Sync {
  fn canonicalize(
    &self,
    path: &Path,
    cache: &DashMap<PathBuf, Option<PathBuf>, GxBuildHasher>,
  ) -> Result<PathBuf>;
  fn read(&self, path: &Path) -> Result<Vec<u8>>;
  fn read_to_string(&self, path: &Path) -> Result<String>;
  fn is_file(&self, path: &Path) -> bool;
  fn is_dir(&self, path: &Path) -> bool;
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub struct OsFileSystem;

#[cfg(not(target_arch = "wasm32"))]
impl FileSystem for OsFileSystem {
  fn canonicalize(
    &self,
    path: &Path,
    cache: &DashMap<PathBuf, Option<PathBuf>, GxBuildHasher>,
  ) -> Result<PathBuf> {
    canonicalize(path.as_ref(), cache)
  }

  fn read(&self, path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path)
  }

  fn read_to_string(&self, path: &Path) -> Result<String> {
    std::fs::read_to_string(path)
  }

  fn is_file(&self, path: &Path) -> bool {
    let path: &Path = path.as_ref();
    path.is_file()
  }

  fn is_dir(&self, path: &Path) -> bool {
    let path: &Path = path.as_ref();
    path.is_dir()
  }
}

impl FileSystem for Arc<dyn FileSystem> {
  fn canonicalize(
    &self,
    path: &Path,
    cache: &DashMap<PathBuf, Option<PathBuf>, GxBuildHasher>,
  ) -> Result<PathBuf> {
    (**self).canonicalize(path, cache)
  }

  fn read(&self, path: &Path) -> Result<Vec<u8>> {
    (**self).read(path)
  }

  fn read_to_string(&self, path: &Path) -> Result<String> {
    (**self).read_to_string(path)
  }

  fn is_file(&self, path: &Path) -> bool {
    (**self).is_file(path)
  }

  fn is_dir(&self, path: &Path) -> bool {
    (**self).is_dir(path)
  }
}
