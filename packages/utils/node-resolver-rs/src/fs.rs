use std::{
  io::Result,
  path::{Path, PathBuf},
};

#[cfg(not(target_arch = "wasm32"))]
use crate::path::canonicalize;
use dashmap::DashMap;

pub trait FileSystem {
  fn canonicalize<P: AsRef<Path>>(
    &self,
    path: P,
    cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> Result<PathBuf>;
  fn read_to_string<P: AsRef<Path>>(&self, path: P) -> Result<String>;
  fn is_file<P: AsRef<Path>>(&self, path: P) -> bool;
  fn is_dir<P: AsRef<Path>>(&self, path: P) -> bool;
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub struct OsFileSystem;

#[cfg(not(target_arch = "wasm32"))]
impl FileSystem for OsFileSystem {
  fn canonicalize<P: AsRef<Path>>(
    &self,
    path: P,
    cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> Result<PathBuf> {
    canonicalize(path.as_ref(), cache)
  }

  fn read_to_string<P: AsRef<Path>>(&self, path: P) -> Result<String> {
    std::fs::read_to_string(path)
  }

  fn is_file<P: AsRef<Path>>(&self, path: P) -> bool {
    let path: &Path = path.as_ref();
    path.is_file()
  }

  fn is_dir<P: AsRef<Path>>(&self, path: P) -> bool {
    let path: &Path = path.as_ref();
    path.is_dir()
  }
}
