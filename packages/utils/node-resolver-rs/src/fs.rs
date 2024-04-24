use std::{
  io::Result,
  path::{Path, PathBuf},
};

#[cfg(not(target_arch = "wasm32"))]
use crate::path::canonicalize;
use dashmap::DashMap;

pub trait FileSystem {
  fn cwd(&self) -> Result<PathBuf> {
    Err(std::io::Error::new(
      std::io::ErrorKind::Other,
      "Not implemented",
    ))
  }
  fn canonicalize_base<P: AsRef<Path>>(&self, _path: P) -> Result<PathBuf> {
    Err(std::io::Error::new(
      std::io::ErrorKind::Other,
      "Not implemented",
    ))
  }
  fn canonicalize<P: AsRef<Path>>(
    &self,
    path: P,
    _cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> Result<PathBuf> {
    self.canonicalize_base(path)
  }
  fn read_to_string<P: AsRef<Path>>(&self, path: P) -> Result<String>;
  fn is_file<P: AsRef<Path>>(&self, path: P) -> bool;
  fn is_dir<P: AsRef<Path>>(&self, path: P) -> bool;
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub struct OsFileSystem;

#[cfg(not(target_arch = "wasm32"))]
impl FileSystem for OsFileSystem {
  fn cwd(&self) -> Result<PathBuf> {
    std::env::current_dir()
  }

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
