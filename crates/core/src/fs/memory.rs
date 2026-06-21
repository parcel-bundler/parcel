use std::{
  ffi::{OsStr, OsString},
  io::{Error, ErrorKind, Result},
  path::{Component, Path, PathBuf},
  sync::Mutex,
};

use super::{DirEntry, FileKind, FileStat, FileSystem};

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
    let mut node = 0;
    for component in path.components() {
      match component {
        Component::CurDir => {}
        Component::ParentDir => {
          let entries = self.entries.lock().unwrap();
          let entry = &entries[node];
          if let Some(parent) = entry.parent() {
            node = parent;
          } else {
            return Err(Error::new(ErrorKind::NotFound, "not found"));
          }
        }
        Component::Prefix(_) => todo!(),
        Component::RootDir => {
          node = 0;
        }
        Component::Normal(name) => {
          node = self.entry(node, name)?;
        }
      }
    }

    Ok(node)
  }

  fn entry(&self, parent: usize, name: &OsStr) -> Result<usize> {
    let entries = self.entries.lock().unwrap();
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

  pub fn mkdir(&self, path: &Path) -> Result<()> {
    let name = path.file_name().unwrap();
    let node = path.parent().map_or(Ok(0), |p| self.dir(p))?;
    let found = self.entry(node, name);
    if found.is_ok() {
      return Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "already exists",
      ));
    }

    let mut entries = self.entries.lock().unwrap();
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
  }
}

impl FileSystem for MemoryFileSystem {
  fn kind(&self, path: &Path) -> FileKind {
    let name = path.file_name().unwrap();
    let node = path.parent().map_or(Ok(0), |p| self.dir(p));
    if let Ok(found) = node.and_then(|node| self.entry(node, name)) {
      let entries = self.entries.lock().unwrap();
      entries[found].kind()
    } else {
      FileKind::empty()
    }
  }

  fn read(&self, path: &Path) -> Result<Vec<u8>> {
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
  }

  fn read_link(&self, _path: &Path) -> Result<PathBuf> {
    todo!()
  }

  fn write(&self, path: &Path, contents: &Vec<u8>) -> Result<()> {
    let name = path.file_name().unwrap();
    let node = path.parent().map_or(Ok(0), |p| self.dir(p))?;
    let found = self.entry(node, name);
    let mut entries = self.entries.lock().unwrap();

    if let Ok(found) = found {
      if let Entry::File {
        contents: file_contents,
        ..
      } = &mut entries[found]
      {
        *file_contents = contents.clone();
      } else {
        return Err(Error::new(ErrorKind::NotFound, "not a file"));
      }
    } else {
      let index = entries.len();
      entries.push(Entry::File {
        name: name.into(),
        contents: contents.clone(),
        parent: Some(node),
      });
      if let Entry::Directory { children, .. } = &mut entries[node] {
        children.push(index);
      }
    }

    Ok(())
  }

  fn remove_file(&self, path: &Path) -> Result<()> {
    let name = path.file_name().unwrap();
    let parent = path.parent().map_or(Ok(0), |p| self.dir(p))?;
    let found = self.entry(parent, name)?;
    let mut entries = self.entries.lock().unwrap();
    if let Entry::Directory { children, .. } = &mut entries[parent] {
      children.retain(|&c| c != found);
      Ok(())
    } else {
      Err(Error::new(ErrorKind::NotADirectory, "not a directory"))
    }
  }

  fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
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
  }

  fn create_dir_all(&self, path: &Path) -> Result<()> {
    let mut node = 0;
    for component in path.components() {
      match component {
        Component::CurDir => {}
        Component::ParentDir => {
          let entries = self.entries.lock().unwrap();
          let entry = &entries[node];
          if let Some(parent) = entry.parent() {
            node = parent;
          } else {
            return Err(Error::new(ErrorKind::NotFound, "not found"));
          }
        }
        Component::Prefix(_) => todo!(),
        Component::RootDir => {
          node = 0;
        }
        Component::Normal(name) => {
          node = match self.entry(node, name) {
            Ok(v) => v,
            Err(e) if e.kind() == ErrorKind::NotFound => {
              let mut entries = self.entries.lock().unwrap();
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
          }
        }
      }
    }

    Ok(())
  }

  fn stat(&self, path: &Path) -> Option<FileStat> {
    let name = path.file_name().unwrap();
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
  }

  fn lstat(&self, path: &Path) -> Option<FileStat> {
    self.stat(path)
  }
}
