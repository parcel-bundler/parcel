use std::{
  ffi::{OsStr, OsString},
  io::{Error, ErrorKind, Result},
  path::{Component, Path, PathBuf},
};

use bitflags::bitflags;

bitflags! {
  /// Bitflags that describe path metadata.
  #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
  pub struct FileKind: u8 {
    /// If set, the path is a file.
    const IS_FILE = 1 << 0;
    /// If set, the path is a directory.
    const IS_DIR = 1 << 1;
    /// If set, the path is a symbolic link.
    const IS_SYMLINK = 1 << 2;
  }
}

/// A trait that provides the functions needed to read files and retrieve metadata from a file system.
pub trait FileSystem: Send + Sync {
  /// Reads the given path as a byte vector.
  fn read(&self, path: &Path) -> Result<Vec<u8>>;

  /// Reads the given path as a string
  fn read_to_string(&self, path: &Path) -> Result<String> {
    String::from_utf8(self.read(path)?).map_err(|e| std::io::Error::other(e))
  }

  /// Returns the kind of file or directory that the given path represents.
  fn kind(&self, path: &Path) -> FileKind;
  /// Returns the resolution of a symbolic link.
  fn read_link(&self, path: &Path) -> Result<PathBuf>;

  fn write(&self, path: &Path, contents: &Vec<u8>) -> Result<()>;

  fn copy(&self, from: &Path, to: &Path) -> Result<()> {
    self.write(to, &self.read(from)?)
  }
}

/// Default operating system file system implementation.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub struct OsFileSystem;

#[cfg(not(target_arch = "wasm32"))]
impl FileSystem for OsFileSystem {
  fn read(&self, path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path)
  }

  fn read_to_string(&self, path: &Path) -> Result<String> {
    std::fs::read_to_string(path)
  }

  fn kind(&self, path: &Path) -> FileKind {
    let mut flags = FileKind::empty();

    // A majority of paths are not symlinks. symlink_metadata will tell us whether a path is a symlink,
    // and if not, also whether the path is a file or directory. If it was a symlink we'll need to make
    // another call to get the metadata of the underlying path, but this is rare.
    if let Ok(metadata) = path.symlink_metadata() {
      if metadata.is_symlink() {
        flags.set(FileKind::IS_SYMLINK, true);
        if let Ok(metadata) = path.metadata() {
          flags.set(FileKind::IS_FILE, metadata.is_file());
          flags.set(FileKind::IS_DIR, metadata.is_dir());
        }
      } else {
        flags.set(FileKind::IS_FILE, metadata.is_file());
        flags.set(FileKind::IS_DIR, metadata.is_dir());
      }
    }

    flags
  }

  fn read_link(&self, path: &Path) -> Result<PathBuf> {
    path.read_link()
  }

  fn write(&self, path: &Path, contents: &Vec<u8>) -> Result<()> {
    std::fs::write(path, contents)
  }

  fn copy(&self, from: &Path, to: &Path) -> Result<()> {
    std::fs::copy(from, to).map(|_| ())
  }
}

pub struct MemoryFileSystem {
  entries: Vec<Entry>,
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
      entries: vec![Entry::Directory {
        name: OsString::new(),
        children: vec![],
        parent: None,
      }],
    }
  }

  fn dir(&self, path: &Path) -> Result<usize> {
    let mut node = 0;
    for component in path.components() {
      match component {
        Component::CurDir => {}
        Component::ParentDir => {
          let entry = &self.entries[node];
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
    let entry = &self.entries[parent];
    if let Entry::Directory { children, .. } = entry {
      for child in children {
        if self.entries[*child].name() == name {
          return Ok(*child);
        }
      }

      Err(Error::new(ErrorKind::NotFound, "not found"))
    } else {
      Err(Error::new(ErrorKind::NotADirectory, "not a directory"))
    }
  }

  pub fn write(&mut self, path: &Path, contents: Vec<u8>) -> Result<()> {
    let name = path.file_name().unwrap();
    let node = path.parent().map_or(Ok(0), |p| self.dir(p))?;
    let found = self.entry(node, name);

    if let Ok(found) = found {
      if let Entry::File {
        contents: file_contents,
        ..
      } = &mut self.entries[found]
      {
        *file_contents = contents;
      } else {
        return Err(Error::new(ErrorKind::NotFound, "not a file"));
      }
    } else {
      let index = self.entries.len();
      self.entries.push(Entry::File {
        name: name.into(),
        contents,
        parent: Some(node),
      });
      if let Entry::Directory { children, .. } = &mut self.entries[node] {
        children.push(index);
      }
    }

    Ok(())
  }

  pub fn mkdir(&mut self, path: &Path) -> Result<()> {
    let name = path.file_name().unwrap();
    let node = path.parent().map_or(Ok(0), |p| self.dir(p))?;
    let found = self.entry(node, name);
    if found.is_ok() {
      return Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "already exists",
      ));
    }

    let index = self.entries.len();
    self.entries.push(Entry::Directory {
      name: name.into(),
      children: vec![],
      parent: Some(node),
    });
    if let Entry::Directory { children, .. } = &mut self.entries[node] {
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
      self.entries[found].kind()
    } else {
      FileKind::empty()
    }
  }

  fn read(&self, path: &Path) -> Result<Vec<u8>> {
    let name = path.file_name().unwrap();
    let node = path.parent().map_or(Ok(0), |p| self.dir(p))?;
    if let Ok(found) = self.entry(node, name) {
      if let Entry::File { contents, .. } = &self.entries[found] {
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

  fn write(&self, _path: &Path, _contents: &Vec<u8>) -> Result<()> {
    todo!()
  }
}
