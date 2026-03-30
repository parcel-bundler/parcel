use std::{
  ffi::{OsStr, OsString},
  io::{Error, ErrorKind, Result},
  path::{Component, Path, PathBuf},
  sync::Mutex,
};

use bitflags::bitflags;
use glob_match::glob_match;

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

#[derive(Debug)]
pub struct DirEntry {
  pub name: OsString,
  pub kind: FileKind,
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

  fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>>;

  fn create_dir_all(&self, path: &Path) -> Result<()>;
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

  fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
    let dir = path.read_dir()?;
    let mut entries = Vec::new();
    for ent in dir {
      let ent = ent?;
      let ty = ent.file_type()?;
      let mut kind = FileKind::empty();
      kind.set(FileKind::IS_DIR, ty.is_dir());
      kind.set(FileKind::IS_FILE, ty.is_file());
      kind.set(FileKind::IS_SYMLINK, ty.is_symlink());
      entries.push(DirEntry {
        name: ent.file_name(),
        kind,
      });
    }

    Ok(entries)
  }

  fn create_dir_all(&self, path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)
  }
}

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
}

pub fn glob(fs: &dyn FileSystem, pattern: &str, cwd: &Path) -> Vec<PathBuf> {
  if !is_glob(pattern) {
    let mut path = Path::new(pattern).to_path_buf();
    if !path.is_absolute() {
      path = cwd.join(path);
    }
    if !fs.kind(&path).is_empty() {
      return vec![path];
    }
    return Vec::new();
  }

  let (dir, file) = pattern.rsplit_once('/').unwrap_or(("", pattern));
  let mut matches = Vec::new();

  if !is_glob(dir) {
    let mut path = Path::new(dir).to_path_buf();
    if !path.is_absolute() {
      path = cwd.join(path);
    }
    match_dir(fs, &path, file, &mut matches);
  } else {
    for dir in glob(fs, dir, cwd) {
      match_dir(fs, &dir, file, &mut matches)
    }
  }

  matches
}

#[inline]
pub fn is_glob(pattern: &str) -> bool {
  pattern.contains(&['*', '?', '[', '{'])
}

fn match_dir(fs: &dyn FileSystem, dir_path: &Path, pattern: &str, matches: &mut Vec<PathBuf>) {
  if let Ok(mut entries) = fs.read_dir(dir_path) {
    let is_globstar = pattern == "**";
    if is_globstar {
      matches.push(dir_path.to_path_buf());
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));

    for entry in entries {
      if let Some(name) = entry.name.to_str() {
        if is_globstar {
          if entry.kind.contains(FileKind::IS_DIR) {
            match_dir(fs, &dir_path.join(name), pattern, matches);
          } else {
            matches.push(dir_path.join(name));
          }
        } else {
          if glob_match(pattern, name) {
            matches.push(dir_path.join(name));
          }
        }
      }
    }
  }
}
