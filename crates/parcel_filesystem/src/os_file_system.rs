use std::path::Path;
use std::path::PathBuf;

use canonicalize::canonicalize;
use dashmap::DashMap;

use crate::FileSystem;

mod canonicalize;

#[derive(Default)]
pub struct OsFileSystem;

impl FileSystem for OsFileSystem {
  fn cwd(&self) -> std::io::Result<PathBuf> {
    std::env::current_dir()
  }

  fn canonicalize<P: AsRef<Path>>(
    &self,
    path: P,
    cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> std::io::Result<PathBuf> {
    canonicalize(path.as_ref(), cache)
  }

  fn read_to_string<P: AsRef<Path>>(&self, path: P) -> std::io::Result<String> {
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
