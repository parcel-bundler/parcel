use std::cell::RefCell;
use std::path::{Path, PathBuf};

use dashmap::DashMap;

use crate::FileSystem;

#[derive(PartialEq, Eq, Debug, PartialOrd)]
pub enum FileSystemOperation {
  Read(PathBuf),
  Stat(PathBuf),
  Cwd,
  Canonicalize(PathBuf),
}

impl FileSystemOperation {
  /// Return the path this operation refers to if it's a path-based operation.
  pub fn path(&self) -> Option<PathBuf> {
    match self {
      FileSystemOperation::Read(path) => Some(path.clone()),
      FileSystemOperation::Stat(path) => Some(path.clone()),
      FileSystemOperation::Canonicalize(path) => Some(path.clone()),
      _ => None,
    }
  }
}

/// This is a FileSystem implementation that tracks reads and writes to a delegate filesystem
/// implementation.
///
/// The purpose of this is to implement objects that access the file-system, and automatically
/// register invalidations for all files read.
pub struct TrackingFileSystem<Fs: FileSystem> {
  delegate: Fs,
  operations: RefCell<Vec<FileSystemOperation>>,
}

impl<Fs: FileSystem> TrackingFileSystem<Fs> {
  pub fn new(delegate: Fs) -> Self {
    Self {
      delegate,
      operations: RefCell::new(Vec::new()),
    }
  }

  /// Take all the recorded operations and clear the operations buffer.
  pub fn take_operations(&self) -> Vec<FileSystemOperation> {
    let operations = self.operations.replace(Vec::new());
    operations
  }
}

impl<Fs> FileSystem for TrackingFileSystem<Fs>
where
  Fs: FileSystem,
{
  fn cwd(&self) -> std::io::Result<PathBuf> {
    self.operations.borrow_mut().push(FileSystemOperation::Cwd);
    self.delegate.cwd()
  }

  fn canonicalize_base(&self, path: &Path) -> std::io::Result<PathBuf> {
    self
      .operations
      .borrow_mut()
      .push(FileSystemOperation::Canonicalize(path.to_path_buf()));
    self.delegate.canonicalize_base(path)
  }

  fn canonicalize(
    &self,
    path: &Path,
    cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> std::io::Result<PathBuf> {
    self
      .operations
      .borrow_mut()
      .push(FileSystemOperation::Canonicalize(path.to_path_buf()));
    self.delegate.canonicalize(path, cache)
  }

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    self
      .operations
      .borrow_mut()
      .push(FileSystemOperation::Read(path.to_path_buf()));
    self.delegate.read_to_string(path)
  }

  fn is_file(&self, path: &Path) -> bool {
    self
      .operations
      .borrow_mut()
      .push(FileSystemOperation::Stat(path.to_path_buf()));
    self.delegate.is_file(path)
  }

  fn is_dir(&self, path: &Path) -> bool {
    self
      .operations
      .borrow_mut()
      .push(FileSystemOperation::Stat(path.to_path_buf()));
    self.delegate.is_dir(path)
  }
}

#[cfg(test)]
mod test {
  use std::path::{Path, PathBuf};
  use std::sync::Arc;

  use crate::{FileSystem, FileSystemRef, MockFileSystem};

  use super::*;

  #[test]
  fn test_tracking_filesystem() {
    let mut child = MockFileSystem::new();
    child
      .expect_canonicalize()
      .returning(|_, _| Ok(PathBuf::from("foo")));
    child.expect_cwd().returning(|| Ok(PathBuf::from("foo")));
    child
      .expect_read_to_string()
      .returning(|_| Ok("".to_string()));
    child.expect_is_file().returning(|_| true);
    child.expect_is_dir().returning(|_| true);

    let fs = TrackingFileSystem::new(child);

    let _ = fs.cwd();
    let _ = fs.canonicalize(Path::new("foo"), &DashMap::new());
    let _ = fs.read_to_string(Path::new("bar"));
    let _ = fs.is_file(Path::new("bar"));
    let _ = fs.is_dir(Path::new("bar"));

    let operations = fs.take_operations();
    assert_eq!(operations.len(), 5);
    assert_eq!(operations[0], FileSystemOperation::Cwd);
    assert_eq!(
      operations[1],
      FileSystemOperation::Canonicalize(PathBuf::from("foo"))
    );
    assert_eq!(
      operations[2],
      FileSystemOperation::Read(PathBuf::from("bar"))
    );
    assert_eq!(
      operations[3],
      FileSystemOperation::Stat(PathBuf::from("bar"))
    );
    assert_eq!(
      operations[4],
      FileSystemOperation::Stat(PathBuf::from("bar"))
    );

    let operations = fs.take_operations();
    assert_eq!(operations.len(), 0);
  }

  #[test]
  fn test_create_tracking_file_system_from_ref() {
    let child = MockFileSystem::new();
    let _tracking = TrackingFileSystem::new(&child);
    let child: FileSystemRef = Arc::new(MockFileSystem::new());
    let _tracking = TrackingFileSystem::new(&child);
    let _tracking = TrackingFileSystem::new(child);
  }
}
