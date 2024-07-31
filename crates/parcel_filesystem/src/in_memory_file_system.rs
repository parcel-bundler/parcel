use std::collections::HashMap;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;
use std::sync::RwLock;

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
  files: RwLock<HashMap<PathBuf, InMemoryFileSystemEntry>>,
  current_working_directory: RwLock<PathBuf>,
}

impl InMemoryFileSystem {
  /// Change the current working directory. Used for resolving relative paths.
  pub fn set_current_working_directory(&self, cwd: &Path) {
    let cwd = self.canonicalize_impl(cwd);
    let mut state = self.current_working_directory.write().unwrap();
    *state = cwd;
  }

  /// Write a file at path.
  pub fn write_file(&self, path: &Path, contents: String) {
    let path = self.canonicalize_impl(path);
    let mut files = self.files.write().unwrap();
    files.insert(path.clone(), InMemoryFileSystemEntry::File { contents });

    let mut dir = path.parent();
    while let Some(path) = dir {
      files.insert(path.to_path_buf(), InMemoryFileSystemEntry::Directory);
      dir = path.parent();
    }
  }

  fn canonicalize_impl(&self, path: &Path) -> PathBuf {
    let cwd = self.current_working_directory.read().unwrap();
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
          result.push(Component::RootDir);
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

    PathBuf::from_iter(result)
  }
}

#[cfg(not(target_os = "windows"))]
fn root_dir() -> PathBuf {
  PathBuf::from("/")
}

#[cfg(target_os = "windows")]
fn root_dir() -> PathBuf {
  PathBuf::from("C:/")
}

impl Default for InMemoryFileSystem {
  fn default() -> Self {
    Self {
      files: Default::default(),
      current_working_directory: RwLock::new(root_dir()),
    }
  }
}

impl FileSystem for InMemoryFileSystem {
  fn cwd(&self) -> std::io::Result<PathBuf> {
    Ok(self.current_working_directory.read().unwrap().clone())
  }

  fn canonicalize_base(&self, path: &Path) -> std::io::Result<PathBuf> {
    Ok(self.canonicalize_impl(path))
  }

  fn create_directory(&self, path: &Path) -> std::io::Result<()> {
    let mut files = self.files.write().unwrap();
    let path = self.canonicalize_impl(path);
    files.insert(path.into(), InMemoryFileSystemEntry::Directory);
    Ok(())
  }

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    let path = self.canonicalize_impl(path);
    let files = self.files.read().unwrap();
    files.get(&path).map_or_else(
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
    let path = self.canonicalize_impl(path);
    let files = self.files.read().unwrap();
    let file = files.get(&path);
    matches!(file, Some(InMemoryFileSystemEntry::File { .. }))
  }

  fn is_dir(&self, path: &Path) -> bool {
    let path = self.canonicalize_impl(path);
    let files = self.files.read().unwrap();
    let file = files.get(&path);
    matches!(file, Some(InMemoryFileSystemEntry::Directory { .. }))
  }
}

#[cfg(test)]
mod test {
  use super::*;

  #[test]
  fn test_canonicalize_noop() {
    let fs = InMemoryFileSystem::default();
    let path = root_dir().join("foo/bar");
    let result = fs.canonicalize(&path, &Default::default()).unwrap();
    assert_eq!(result, path);
  }

  #[test]
  fn test_remove_relative_dots() {
    let fs = InMemoryFileSystem::default();
    let result = fs
      .canonicalize(&root_dir().join("foo/./bar"), &Default::default())
      .unwrap();
    assert_eq!(result, root_dir().join("foo/bar"));
  }

  #[test]
  fn test_remove_relative_parent_dots() {
    let fs = InMemoryFileSystem::default();
    let result = fs
      .canonicalize(&root_dir().join("/foo/./bar/../baz/"), &Default::default())
      .unwrap();
    assert_eq!(result, root_dir().join("/foo/baz"));
  }

  #[test]
  fn test_with_cwd() {
    let fs = InMemoryFileSystem::default();
    fs.set_current_working_directory(Path::new("/other"));
    let result = fs
      .canonicalize(Path::new("./foo/./bar/../baz/"), &Default::default())
      .unwrap();
    assert_eq!(result, root_dir().join("/other/foo/baz"));
    assert!(result.is_absolute());
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
    let cwd = PathBuf::from("parcel");
    let fs = InMemoryFileSystem::default();

    fs.write_file(&PathBuf::from("/foo/bar"), String::default());

    assert!(fs.is_file(Path::new("/foo/bar")));
    assert!(!fs.is_file(Path::new("/foo")));

    fs.write_file(&cwd.join("src").join("a.js"), String::default());

    assert!(fs.is_file(&cwd.join("src").join("a.js")));
    assert!(fs.is_file(&cwd.join("src/a.js")));
  }

  #[test]
  fn test_is_dir() {
    let fs = InMemoryFileSystem::default();

    fs.create_directory(&PathBuf::from("/foo"))
      .expect("Expected /foo directory to be created");

    assert!(fs.is_dir(Path::new("/foo")));
    assert!(!fs.is_dir(Path::new("/foo/bar")));
  }

  #[test]
  fn test_changing_the_cwd_will_correctly_resolve_files() {
    let cwd = PathBuf::from("/foo");
    let fs = InMemoryFileSystem::default();
    fs.set_current_working_directory(&cwd);
    fs.write_file(&PathBuf::from("bar"), String::default());
    assert!(fs.is_file(Path::new("bar")));
    fs.set_current_working_directory(Path::new("/"));
    assert!(fs.is_file(Path::new("/foo/bar")));
  }

  #[cfg(target_os = "windows")]
  mod windows_tests {
    use super::*;

    #[test]
    fn test_the_prefix_will_be_carried_onto_canonicalize_paths() {
      let cwd = PathBuf::from("C:\\foo");
      let fs = InMemoryFileSystem::default();
      fs.set_current_working_directory(&cwd);
      let result = fs.canonicalize_impl(Path::new("\\something"));
      assert_eq!(result, PathBuf::from("C:\\something"));
    }
  }
}
