use std::{
  io::Result,
  path::{Path, PathBuf},
};

pub trait FileSystem {
  fn canonicalize<P: AsRef<Path>>(&self, path: P) -> Result<PathBuf>;
  fn read_to_string<P: AsRef<Path>>(&self, path: P) -> Result<String>;
  fn is_file<P: AsRef<Path>>(&self, path: P) -> bool;
  fn is_dir<P: AsRef<Path>>(&self, path: P) -> bool;
}

#[derive(Default)]
pub struct OsFileSystem;

impl FileSystem for OsFileSystem {
  fn canonicalize<P: AsRef<Path>>(&self, path: P) -> Result<PathBuf> {
    std::fs::canonicalize(path)
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
