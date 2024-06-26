#![deny(unused_crate_dependencies)]
use std::io::Result;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use dashmap::DashMap;

/// In-memory file-system for testing
pub mod in_memory_file_system;

pub mod search;

/// File-system implementation using std::fs and a canonicalize cache
pub mod os_file_system;

/// FileSystem abstraction instance.
/// This should be `OsFileSystem` for non-testing environments and `InMemoryFileSystem` for
/// testing.
pub type FileSystemRef = Arc<dyn FileSystem + Send + Sync>;

/// Trait abstracting file-system operations
/// .
///
/// ## TODO list
///
/// * [ ] Do not leak dash-map cache into calls. Instead this should be managed by implementations;
///       it should not be in the trait
/// * [ ] Do not use io results, instead use anyhow or this error
///
#[mockall::automock]
pub trait FileSystem {
  fn cwd(&self) -> Result<PathBuf> {
    Err(std::io::Error::new(
      std::io::ErrorKind::Other,
      "Not implemented",
    ))
  }
  fn canonicalize_base(&self, _path: &Path) -> Result<PathBuf> {
    Err(std::io::Error::new(
      std::io::ErrorKind::Other,
      "Not implemented",
    ))
  }
  fn canonicalize(
    &self,
    path: &Path,
    _cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> Result<PathBuf> {
    self.canonicalize_base(path)
  }
  fn read_to_string(&self, path: &Path) -> Result<String>;
  fn is_file(&self, path: &Path) -> bool;
  fn is_dir(&self, path: &Path) -> bool;
}
