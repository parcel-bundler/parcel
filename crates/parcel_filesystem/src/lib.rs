use std::io::Result;
use std::path::Path;
use std::path::PathBuf;

use dashmap::DashMap;

/// FileSystem implementation that delegates calls to a JS object
pub mod js_delegate_file_system;

/// In-memory file-system for testing
pub mod in_memory_file_system;

pub mod search;

/// File-system implementation using std::fs and a canonicalize cache
#[cfg(not(target_arch = "wasm32"))]
pub mod os_file_system;

/// Trait abstracting file-system operations
/// .
///
/// ## TODO list
///
/// * [ ] Do not leak dash-map cache into calls. Instead this should be managed by implementations;
///       it should not be in the trait
/// * [ ] Do not use io results, instead use anyhow or this error
///
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
