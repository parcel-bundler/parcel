use std::{
  ffi::OsString,
  io::{Error, ErrorKind, Result},
};

use super::{DirEntry, FileKind, FileStat, FileSystem, MemoryFileSystem, OsFileSystem};
use crate::PathId;

pub struct OverlayFileSystem {
  pub mem: MemoryFileSystem,
  pub os: OsFileSystem,
}

impl OverlayFileSystem {
  pub fn new() -> OverlayFileSystem {
    OverlayFileSystem {
      mem: MemoryFileSystem::new(),
      os: OsFileSystem::default(),
    }
  }
}

impl FileSystem for OverlayFileSystem {
  fn read(&self, path: PathId) -> Result<Vec<u8>> {
    match self.mem.read(path) {
      Ok(v) => Ok(v),
      Err(e) if e.kind() == ErrorKind::NotFound => self.os.read(path),
      Err(e) => Err(e),
    }
  }

  fn kind(&self, path: PathId) -> FileKind {
    let mem_kind = self.mem.kind(path);
    if !mem_kind.is_empty() {
      mem_kind
    } else {
      self.os.kind(path)
    }
  }

  fn read_link(&self, path: PathId) -> Result<PathId> {
    // MemoryFileSystem does not support symlinks (read_link is unimplemented), so delegate to the
    // OS filesystem when the path is not present in memory. If it is present in memory, return an
    // error indicating it's unsupported.
    let mem_kind = self.mem.kind(path);
    if mem_kind.is_empty() {
      self.os.read_link(path)
    } else {
      Err(Error::new(
        ErrorKind::Other,
        "read_link not supported for memory file system",
      ))
    }
  }

  fn write(&self, path: PathId, contents: &Vec<u8>) -> Result<()> {
    self.mem.write(path, contents)
  }

  fn remove_file(&self, path: PathId) -> Result<()> {
    self.mem.remove_file(path)
  }

  fn read_dir(&self, path: PathId) -> Result<Vec<DirEntry>> {
    let mem_entries = match self.mem.read_dir(path) {
      Ok(v) => v,
      Err(e) if e.kind() == ErrorKind::NotFound => Vec::new(),
      Err(e) => return Err(e),
    };

    let os_entries = match self.os.read_dir(path) {
      Ok(v) => v,
      Err(e) if e.kind() == ErrorKind::NotFound => Vec::new(),
      Err(e) => return Err(e),
    };

    use std::collections::BTreeMap;
    let mut map: BTreeMap<OsString, DirEntry> = BTreeMap::new();

    for entry in os_entries.into_iter() {
      map.insert(entry.name.clone(), entry);
    }

    // Memory entries take precedence over OS entries.
    for entry in mem_entries.into_iter() {
      map.insert(entry.name.clone(), entry);
    }

    let mut entries: Vec<DirEntry> = map.into_values().collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
  }

  fn create_dir_all(&self, path: PathId) -> Result<()> {
    self.mem.create_dir_all(path)
  }

  fn stat(&self, path: PathId) -> Option<FileStat> {
    let mem_stat = self.mem.stat(path);
    if mem_stat.is_some() {
      return mem_stat;
    }
    self.os.stat(path)
  }

  fn lstat(&self, path: PathId) -> Option<FileStat> {
    let mem_stat = self.mem.lstat(path);
    if mem_stat.is_some() {
      return mem_stat;
    }
    self.os.lstat(path)
  }
}
