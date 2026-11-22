use std::{
  ffi::{OsStr, OsString},
  io::{Error, ErrorKind, Result},
  path::{Component, Path},
  sync::Mutex,
};

use super::{DirEntry, FileKind, FileStat, FileSystem};
use crate::PathId;

pub struct MemoryFileSystem {
  entries: Mutex<Vec<Entry>>,
}

enum Entry {
  Directory {
    name: OsString,
    children: Vec<usize>,
    parent: Option<usize>,
  },
  File {
    name: OsString,
    contents: Vec<u8>,
    parent: Option<usize>,
  },
}

impl Entry {
  fn parent(&self) -> Option<usize> {
    match self {
      Entry::Directory { parent, .. } => *parent,
      Entry::File { parent, .. } => *parent,
    }
  }

  fn name(&self) -> &OsStr {
    match self {
      Entry::Directory { name, .. } => name,
      Entry::File { name, .. } => name,
    }
  }

  fn kind(&self) -> FileKind {
    match self {
      Entry::Directory { .. } => FileKind::IS_DIR,
      Entry::File { .. } => FileKind::IS_FILE,
    }
  }
}

impl MemoryFileSystem {
  pub fn new() -> MemoryFileSystem {
    MemoryFileSystem {
      entries: Mutex::new(vec![Entry::Directory {
        name: OsString::new(),
        children: vec![],
        parent: None,
      }]),
    }
  }

  fn dir(&self, path: &Path) -> Result<usize> {
    let entries = self.entries.lock().unwrap();
    Self::dir_in(&entries, path)
  }

  fn dir_in(entries: &[Entry], path: &Path) -> Result<usize> {
    let mut node = 0;
    let mut root = 0;
    for component in path.components() {
      match component {
        Component::CurDir => {}
        Component::ParentDir => {
          let entry = &entries[node];
          if let Some(parent) = entry.parent() {
            node = parent;
          } else {
            return Err(Error::new(ErrorKind::NotFound, "not found"));
          }
        }
        Component::Prefix(prefix) => {
          root = Self::entry_in(entries, 0, prefix.as_os_str())?;
          node = root;
        }
        Component::RootDir => {
          node = root;
        }
        Component::Normal(name) => {
          node = Self::entry_in(entries, node, name)?;
        }
      }
    }

    Ok(node)
  }

  fn entry(&self, parent: usize, name: &OsStr) -> Result<usize> {
    let entries = self.entries.lock().unwrap();
    Self::entry_in(&entries, parent, name)
  }

  fn entry_in(entries: &[Entry], parent: usize, name: &OsStr) -> Result<usize> {
    let entry = &entries[parent];
    if let Entry::Directory { children, .. } = entry {
      for child in children {
        if entries[*child].name() == name {
          return Ok(*child);
        }
      }

      Err(Error::new(ErrorKind::NotFound, "not found"))
    } else {
      Err(Error::new(ErrorKind::NotADirectory, "not a directory"))
    }
  }

  /// Finds the entry at `path`, returning it along with its parent directory.
  fn parent_and_entry(entries: &[Entry], path: &Path) -> Result<(usize, usize)> {
    let Some(name) = path.file_name() else {
      return Err(Error::new(
        ErrorKind::PermissionDenied,
        "can't remove the root directory",
      ));
    };
    let parent = path.parent().map_or(Ok(0), |p| Self::dir_in(entries, p))?;
    Ok((parent, Self::entry_in(entries, parent, name)?))
  }

  /// Removes the entry at `path` from its parent directory, after checking it with `check`.
  fn remove(&self, path: PathId, check: impl FnOnce(&Entry) -> Result<()>) -> Result<()> {
    path.with_path(|path| {
      let mut entries = self.entries.lock().unwrap();
      let (parent, found) = Self::parent_and_entry(&entries, path)?;
      check(&entries[found])?;
      if let Entry::Directory { children, .. } = &mut entries[parent] {
        children.retain(|&c| c != found);
      }
      Ok(())
    })
  }
}

impl FileSystem for MemoryFileSystem {
  fn kind(&self, path: PathId) -> FileKind {
    path.with_path(|path| {
      let Some(name) = path.file_name() else {
        return if self.dir(path).is_ok() {
          FileKind::IS_DIR
        } else {
          FileKind::empty()
        };
      };
      let node = path.parent().map_or(Ok(0), |p| self.dir(p));
      if let Ok(found) = node.and_then(|node| self.entry(node, name)) {
        let entries = self.entries.lock().unwrap();
        entries[found].kind()
      } else {
        FileKind::empty()
      }
    })
  }

  fn read(&self, path: PathId) -> Result<Vec<u8>> {
    path.with_path(|path| {
      let name = path.file_name().unwrap();
      let node = path.parent().map_or(Ok(0), |p| self.dir(p))?;
      if let Ok(found) = self.entry(node, name) {
        let entries = self.entries.lock().unwrap();
        if let Entry::File { contents, .. } = &entries[found] {
          Ok(contents.clone())
        } else {
          Err(std::io::Error::new(
            std::io::ErrorKind::NotADirectory,
            "not a directory",
          ))
        }
      } else {
        Err(std::io::Error::new(
          std::io::ErrorKind::NotFound,
          "not found",
        ))
      }
    })
  }

  fn read_link(&self, _path: PathId) -> Result<PathId> {
    todo!()
  }

  fn write(&self, path: PathId, contents: &[u8]) -> Result<()> {
    path.with_path(|path| {
      let name = path.file_name().unwrap();
      let mut entries = self.entries.lock().unwrap();
      let node = path.parent().map_or(Ok(0), |p| Self::dir_in(&entries, p))?;
      let found = Self::entry_in(&entries, node, name);

      if let Ok(found) = found {
        if let Entry::File {
          contents: file_contents,
          ..
        } = &mut entries[found]
        {
          *file_contents = contents.to_vec();
        } else {
          return Err(Error::new(ErrorKind::NotFound, "not a file"));
        }
      } else {
        let index = entries.len();
        entries.push(Entry::File {
          name: name.into(),
          contents: contents.to_vec(),
          parent: Some(node),
        });
        if let Entry::Directory { children, .. } = &mut entries[node] {
          children.push(index);
        }
      }

      Ok(())
    })
  }

  fn remove_file(&self, path: PathId) -> Result<()> {
    self.remove(path, |entry| match entry {
      Entry::File { .. } => Ok(()),
      Entry::Directory { .. } => Err(Error::new(ErrorKind::IsADirectory, "is a directory")),
    })
  }

  fn remove_dir(&self, path: PathId) -> Result<()> {
    self.remove(path, |entry| match entry {
      Entry::Directory { children, .. } if children.is_empty() => Ok(()),
      Entry::Directory { .. } => Err(Error::new(
        ErrorKind::DirectoryNotEmpty,
        "directory not empty",
      )),
      Entry::File { .. } => Err(Error::new(ErrorKind::NotADirectory, "not a directory")),
    })
  }

  fn remove_dir_all(&self, path: PathId) -> Result<()> {
    // The removed entries stay in `entries`, unreachable, as `remove_file`'s do.
    self.remove(path, |entry| match entry {
      Entry::Directory { .. } => Ok(()),
      Entry::File { .. } => Err(Error::new(ErrorKind::NotADirectory, "not a directory")),
    })
  }

  fn create_dir(&self, path: PathId) -> Result<()> {
    path.with_path(|path| {
      let Some(name) = path.file_name() else {
        return Err(Error::new(ErrorKind::AlreadyExists, "already exists"));
      };
      // Volume roots (e.g. `C:\`) exist implicitly, as they do on a real file system.
      if let Some(root) = path.parent().filter(|parent| parent.file_name().is_none()) {
        self.create_dir_all(PathId::new(root))?;
      }
      let mut entries = self.entries.lock().unwrap();
      let node = path.parent().map_or(Ok(0), |p| Self::dir_in(&entries, p))?;
      if !matches!(entries[node], Entry::Directory { .. }) {
        return Err(Error::new(ErrorKind::NotADirectory, "not a directory"));
      }
      if Self::entry_in(&entries, node, name).is_ok() {
        return Err(Error::new(ErrorKind::AlreadyExists, "already exists"));
      }

      let index = entries.len();
      entries.push(Entry::Directory {
        name: name.into(),
        children: vec![],
        parent: Some(node),
      });
      if let Entry::Directory { children, .. } = &mut entries[node] {
        children.push(index);
      }
      Ok(())
    })
  }

  fn read_dir(&self, path: PathId) -> Result<Vec<DirEntry>> {
    path.with_path(|path| {
      let dir = self.dir(path)?;
      let entries = self.entries.lock().unwrap();
      let entry = &entries[dir];
      if let Entry::Directory { children, .. } = entry {
        let mut dir_entries = Vec::new();
        for child in children {
          let child = &entries[*child];
          dir_entries.push(match child {
            Entry::Directory { name, .. } => DirEntry {
              name: name.clone(),
              kind: FileKind::IS_DIR,
            },
            Entry::File { name, .. } => DirEntry {
              name: name.clone(),
              kind: FileKind::IS_FILE,
            },
          });
        }

        Ok(dir_entries)
      } else {
        Err(Error::new(ErrorKind::NotADirectory, "not a directory"))
      }
    })
  }

  fn create_dir_all(&self, path: PathId) -> Result<()> {
    path.with_path(|path| {
      let mut entries = self.entries.lock().unwrap();
      let mut node = 0;
      let mut root = 0;
      for component in path.components() {
        let name = match component {
          Component::Prefix(prefix) => Some(prefix.as_os_str()),
          Component::Normal(name) => Some(name),
          _ => None,
        };
        match component {
          Component::CurDir => {}
          Component::ParentDir => {
            let entry = &entries[node];
            if let Some(parent) = entry.parent() {
              node = parent;
            } else {
              return Err(Error::new(ErrorKind::NotFound, "not found"));
            }
          }
          Component::RootDir => {
            node = root;
          }
          Component::Prefix(_) | Component::Normal(_) => {
            let name = name.unwrap();
            if matches!(component, Component::Prefix(_)) {
              node = 0;
            }
            node = match Self::entry_in(&entries, node, name) {
              Ok(v) => v,
              Err(e) if e.kind() == ErrorKind::NotFound => {
                let index = entries.len();
                entries.push(Entry::Directory {
                  name: name.into(),
                  children: vec![],
                  parent: Some(node),
                });
                if let Entry::Directory { children, .. } = &mut entries[node] {
                  children.push(index);
                }
                index
              }
              Err(e) => return Err(e),
            };
            if matches!(component, Component::Prefix(_)) {
              root = node;
            }
          }
        }
      }

      Ok(())
    })
  }

  fn stat(&self, path: PathId) -> Option<FileStat> {
    path.with_path(|path| {
      // Only the root has no file name.
      let Some(name) = path.file_name() else {
        return self
          .dir(path)
          .ok()
          .map(|_| FileStat::new_unavailable(FileKind::IS_DIR));
      };
      let node = path.parent().map_or(Ok(0), |p| self.dir(p)).ok()?;
      let found = self.entry(node, name).ok()?;
      let entries = self.entries.lock().unwrap();
      match &entries[found] {
        Entry::Directory { .. } => Some(FileStat::new_unavailable(FileKind::IS_DIR)),
        Entry::File { contents, .. } => Some(FileStat {
          size: contents.len() as u64,
          kind: FileKind::IS_FILE,
          atime: -1,
          mtime: -1,
          ctime: -1,
          birthtime: -1,
        }),
      }
    })
  }

  fn lstat(&self, path: PathId) -> Option<FileStat> {
    self.stat(path)
  }
}

#[cfg(test)]
mod dir_tests {
  use super::*;
  use crate::test_utils::path as test_path;

  fn pid(s: &str) -> PathId {
    PathId::new(&test_path(s))
  }

  #[test]
  fn create_and_remove_directories() {
    let fs = MemoryFileSystem::new();
    fs.create_dir(pid("/a")).unwrap();
    assert_eq!(
      fs.create_dir(pid("/a")).unwrap_err().kind(),
      ErrorKind::AlreadyExists
    );
    assert_eq!(
      fs.create_dir(pid("/missing/b")).unwrap_err().kind(),
      ErrorKind::NotFound
    );
    fs.write(pid("/a/file.txt"), b"x").unwrap();
    assert_eq!(
      fs.create_dir(pid("/a/file.txt/c")).unwrap_err().kind(),
      ErrorKind::NotADirectory
    );
    fs.create_dir(pid("/a/b")).unwrap();
    assert_eq!(fs.kind(pid("/a/b")), FileKind::IS_DIR);

    assert_eq!(
      fs.remove_dir(pid("/a")).unwrap_err().kind(),
      ErrorKind::DirectoryNotEmpty
    );
    assert_eq!(
      fs.remove_dir(pid("/a/file.txt")).unwrap_err().kind(),
      ErrorKind::NotADirectory
    );
    assert_eq!(
      fs.remove_file(pid("/a/b")).unwrap_err().kind(),
      ErrorKind::IsADirectory
    );
    assert_eq!(
      fs.remove_dir_all(pid("/a/file.txt")).unwrap_err().kind(),
      ErrorKind::NotADirectory
    );
    fs.remove_dir(pid("/a/b")).unwrap();
    assert!(fs.kind(pid("/a/b")).is_empty());

    fs.remove_dir_all(pid("/a")).unwrap();
    assert!(fs.kind(pid("/a")).is_empty());
    assert!(fs.kind(pid("/a/file.txt")).is_empty());
    assert_eq!(
      fs.remove_dir_all(pid("/a")).unwrap_err().kind(),
      ErrorKind::NotFound
    );
  }
}

#[cfg(all(test, windows))]
mod tests {
  use super::*;

  #[test]
  fn volumes_have_independent_files() {
    let fs = MemoryFileSystem::new();
    for (root, content) in [(r"C:\", b"c"), (r"D:\", b"d"), (r"\\server\share\", b"s")] {
      let dir = Path::new(root).join("project");
      let file = PathId::new(&dir.join("a.js"));
      fs.create_dir_all(PathId::new(&dir)).unwrap();
      fs.write(file, content).unwrap();
      assert_eq!(fs.kind(PathId::new(Path::new(root))), FileKind::IS_DIR);
      assert_eq!(fs.read_dir(PathId::new(&dir)).unwrap().len(), 1);
      assert_eq!(
        fs.glob(
          dir.join("*.js").to_str().unwrap(),
          PathId::new(Path::new(root))
        ),
        vec![file]
      );
    }
    for (file, content) in [
      (r"C:\project\a.js", b"c"),
      (r"D:\project\a.js", b"d"),
      (r"\\server\share\project\a.js", b"s"),
      (r"c:\project\a.js", b"c"),
    ] {
      let file = PathId::new(Path::new(file));
      assert_eq!(fs.read(file).unwrap(), content);
      assert_eq!(fs.stat(file).unwrap().size, 1);
    }
  }
}
