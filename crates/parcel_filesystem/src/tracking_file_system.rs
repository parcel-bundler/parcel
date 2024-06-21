use std::cell::RefCell;
use std::path::{Path, PathBuf};

use dashmap::DashMap;

use crate::FileSystem;

pub enum FileSystemOperation {
  Read(PathBuf),
  Stat(PathBuf),
  Cwd,
  Canonicalize(PathBuf),
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
