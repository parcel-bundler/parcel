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

  fn canonicalize(
    &self,
    path: &Path,
    cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> std::io::Result<PathBuf> {
    canonicalize(path, cache)
  }

  fn create_directory(&self, path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)
  }

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
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
