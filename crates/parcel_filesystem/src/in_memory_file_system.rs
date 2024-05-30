use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;

use crate::FileSystem;

/// In memory implementation of a file-system entry
#[derive(Debug)]
enum InMemoryFileSystemEntry {
  File { contents: String },
  Directory,
}

/// In memory implementation of the `FileSystem` trait, for testing purpouses.
#[derive(Debug)]
pub struct InMemoryFileSystem {
  files: RefCell<HashMap<PathBuf, InMemoryFileSystemEntry>>,
  current_working_directory: RefCell<PathBuf>,
}

impl InMemoryFileSystem {
  /// Change the current working directory. Used for resolving relative paths.
  pub fn set_current_working_directory(&self, cwd: PathBuf) {
    self.current_working_directory.replace(cwd);
  }

  /// Create a directory at path.
  pub fn create_directory(&self, path: &Path) {
    self
      .files
      .borrow_mut()
      .insert(path.into(), InMemoryFileSystemEntry::Directory);
  }

  /// Write a file at path.
  pub fn write_file(&self, path: &Path, contents: String) {
    self
      .files
      .borrow_mut()
      .insert(path.into(), InMemoryFileSystemEntry::File { contents });
  }
}

impl Default for InMemoryFileSystem {
  fn default() -> Self {
    Self {
      files: Default::default(),
      current_working_directory: RefCell::new(PathBuf::from("/")),
    }
  }
}

impl FileSystem for InMemoryFileSystem {
  fn cwd(&self) -> std::io::Result<PathBuf> {
    Ok(self.current_working_directory.borrow().clone())
  }

  fn canonicalize_base(&self, path: &Path) -> std::io::Result<PathBuf> {
    let cwd = self.current_working_directory.borrow();
    let mut result = if path.is_absolute() {
      vec![]
    } else {
      cwd.components().collect()
    };

    let components = path.components();
    for component in components {
      match component {
        Component::Prefix(prefix) => {
          result = vec![Component::Prefix(prefix)];
        }
        Component::RootDir => {
          result = vec![Component::RootDir];
        }
        Component::CurDir => {}
        Component::ParentDir => {
          result.pop();
        }
        Component::Normal(path) => {
          result.push(Component::Normal(path));
        }
      }
    }

    Ok(PathBuf::from_iter(result))
  }

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    self.files.borrow().get(path).map_or_else(
      || {
        Err(std::io::Error::new(
          std::io::ErrorKind::NotFound,
          "File not found",
        ))
      },
      |entry| match entry {
        InMemoryFileSystemEntry::File { contents } => Ok(contents.clone()),
        InMemoryFileSystemEntry::Directory => Err(std::io::Error::new(
          std::io::ErrorKind::InvalidInput,
          "Path is a directory",
        )),
      },
    )
  }

  fn is_file(&self, path: &Path) -> bool {
    let files = self.files.borrow();
    let file = files.get(path);
    matches!(file, Some(InMemoryFileSystemEntry::File { .. }))
  }

  fn is_dir(&self, path: &Path) -> bool {
    let files = self.files.borrow();
    let file = files.get(path);
    matches!(file, Some(InMemoryFileSystemEntry::Directory { .. }))
  }
}

#[cfg(test)]
mod test {
  use super::*;

  #[test]
  fn test_canonicalize_noop() {
    let fs = InMemoryFileSystem::default();
    let path = Path::new("/foo/bar");
    let result = fs.canonicalize(path, &Default::default()).unwrap();
    assert_eq!(result, path);
  }

  #[test]
  fn test_remove_relative_dots() {
    let fs = InMemoryFileSystem::default();
    let result = fs
      .canonicalize(Path::new("/foo/./bar"), &Default::default())
      .unwrap();
    assert_eq!(result, PathBuf::from("/foo/bar"));
  }

  #[test]
  fn test_remove_relative_parent_dots() {
    let fs = InMemoryFileSystem::default();
    let result = fs
      .canonicalize(Path::new("/foo/./bar/../baz/"), &Default::default())
      .unwrap();
    assert_eq!(result, PathBuf::from("/foo/baz"));
  }

  #[test]
  fn test_with_cwd() {
    let fs = InMemoryFileSystem::default();
    fs.set_current_working_directory(PathBuf::from("/other"));
    let result = fs
      .canonicalize(Path::new("./foo/./bar/../baz/"), &Default::default())
      .unwrap();
    assert_eq!(result, PathBuf::from("/other/foo/baz"));
  }

  #[test]
  fn test_read_file() {
    let fs = InMemoryFileSystem::default();
    fs.write_file(&PathBuf::from("/foo/bar"), "contents".to_string());
    let result = fs.read_to_string(Path::new("/foo/bar")).unwrap();
    assert_eq!(result, "contents");
  }

  #[test]
  fn test_read_file_not_found() {
    let fs = InMemoryFileSystem::default();
    let result = fs.read_to_string(Path::new("/foo/bar"));
    assert!(result.is_err());
  }

  #[test]
  fn test_is_file() {
    let fs = InMemoryFileSystem::default();
    fs.write_file(&PathBuf::from("/foo/bar"), "contents".to_string());
    assert!(fs.is_file(Path::new("/foo/bar")));
    assert!(!fs.is_file(Path::new("/foo")));
  }

  #[test]
  fn test_is_dir() {
    let fs = InMemoryFileSystem::default();
    fs.create_directory(&PathBuf::from("/foo"));
    assert!(fs.is_dir(Path::new("/foo")));
    assert!(!fs.is_dir(Path::new("/foo/bar")));
  }
}
