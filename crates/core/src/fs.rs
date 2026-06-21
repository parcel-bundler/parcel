use std::{
  ffi::{OsStr, OsString},
  io::{Error, ErrorKind, Result},
  path::{Component, Path, PathBuf, is_separator},
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

/// Metadata returned by `stat` on a file or directory.
#[derive(Debug, Clone)]
pub struct FileStat {
  /// Size of the file in bytes. 0 for directories and symlinks.
  pub size: u64,
  /// File type flags.
  pub kind: FileKind,
  /// Last access time as milliseconds since Unix epoch, or -1 if not available.
  pub atime: i64,
  /// Last modification time as milliseconds since Unix epoch, or -1 if not available.
  pub mtime: i64,
  /// Last status change time as milliseconds since Unix epoch, or -1 if not available.
  pub ctime: i64,
  /// Creation time as milliseconds since Unix epoch, or -1 if not available.
  pub birthtime: i64,
}

impl FileStat {
  /// Create a FileStat with all timestamps set to -1 (unavailable).
  pub fn new_unavailable(kind: FileKind) -> Self {
    Self {
      size: 0,
      kind,
      atime: -1,
      mtime: -1,
      ctime: -1,
      birthtime: -1,
    }
  }

  /// Create a FileStat from std::fs::Metadata.
  pub fn from_metadata(metadata: &std::fs::Metadata, is_symlink: bool) -> Self {
    use std::time::{SystemTime, UNIX_EPOCH};

    fn to_epoch_ms(time: SystemTime) -> i64 {
      match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(e) => -(e.duration().as_millis() as i64),
      }
    }

    let mut kind = FileKind::empty();
    kind.set(FileKind::IS_FILE, metadata.is_file());
    kind.set(FileKind::IS_DIR, metadata.is_dir());
    kind.set(FileKind::IS_SYMLINK, is_symlink);

    Self {
      size: metadata.len(),
      kind,
      atime: to_epoch_ms(metadata.accessed().unwrap_or_else(|_| SystemTime::now())),
      mtime: to_epoch_ms(metadata.modified().unwrap_or_else(|_| SystemTime::now())),
      ctime: to_epoch_ms(metadata.created().unwrap_or_else(|_| SystemTime::now())),
      birthtime: to_epoch_ms(metadata.created().unwrap_or(UNIX_EPOCH)),
    }
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

  /// Returns detailed metadata about the file, following symlinks.
  fn stat(&self, path: &Path) -> Option<FileStat>;

  /// Returns detailed metadata about the file, without following symlinks.
  fn lstat(&self, path: &Path) -> Option<FileStat>;

  /// Returns the resolution of a symbolic link.
  fn read_link(&self, path: &Path) -> Result<PathBuf>;

  fn canonicalize(&self, path: &Path) -> Result<PathBuf> {
    path
      .parent()
      .map(|parent| {
        self.canonicalize(parent).and_then(|parent_canonical| {
          let resolved = parent_canonical.join(path.strip_prefix(parent).map_err(|_| {
            std::io::Error::new(
              std::io::ErrorKind::InvalidFilename,
              "Error stripping prefix",
            )
          })?);

          if self.kind(&path).contains(FileKind::IS_SYMLINK) {
            let link = self.read_link(&resolved)?;
            if link.is_absolute() {
              return self.canonicalize(&link);
            } else {
              return self.canonicalize(&resolve_path(&resolved, &link));
            }
          }

          Ok(resolved)
        })
      })
      .unwrap_or_else(|| Ok(path.to_path_buf()))
  }

  fn write(&self, path: &Path, contents: &Vec<u8>) -> Result<()>;

  fn copy(&self, from: &Path, to: &Path) -> Result<()> {
    self.write(to, &self.read(from)?)
  }

  fn remove_file(&self, path: &Path) -> Result<()>;

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

  fn canonicalize(&self, path: &Path) -> Result<PathBuf> {
    path.canonicalize()
  }

  fn write(&self, path: &Path, contents: &Vec<u8>) -> Result<()> {
    std::fs::write(path, contents)
  }

  fn copy(&self, from: &Path, to: &Path) -> Result<()> {
    std::fs::copy(from, to).map(|_| ())
  }

  fn remove_file(&self, path: &Path) -> Result<()> {
    std::fs::remove_file(path)
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

  fn stat(&self, path: &Path) -> Option<FileStat> {
    path.symlink_metadata().ok().and_then(|meta| {
      let is_symlink = meta.is_symlink();
      let metadata = path.metadata().ok()?;
      Some(FileStat::from_metadata(&metadata, is_symlink))
    })
  }

  fn lstat(&self, path: &Path) -> Option<FileStat> {
    path.symlink_metadata().ok().and_then(|meta| {
      let is_symlink = meta.is_symlink();
      Some(FileStat::from_metadata(&meta, is_symlink))
    })
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

#[cfg(not(target_arch = "wasm32"))]
pub struct OverlayFileSystem {
  pub mem: MemoryFileSystem,
  pub os: OsFileSystem,
}

#[cfg(not(target_arch = "wasm32"))]
impl OverlayFileSystem {
  pub fn new() -> OverlayFileSystem {
    OverlayFileSystem {
      mem: MemoryFileSystem::new(),
      os: OsFileSystem::default(),
    }
  }
}

#[cfg(not(target_arch = "wasm32"))]
impl FileSystem for OverlayFileSystem {
  fn read(&self, path: &Path) -> Result<Vec<u8>> {
    match self.mem.read(path) {
      Ok(v) => Ok(v),
      Err(e) if e.kind() == ErrorKind::NotFound => self.os.read(path),
      Err(e) => Err(e),
    }
  }

  fn kind(&self, path: &Path) -> FileKind {
    let mem_kind = self.mem.kind(path);
    if !mem_kind.is_empty() {
      mem_kind
    } else {
      self.os.kind(path)
    }
  }

  fn read_link(&self, path: &Path) -> Result<PathBuf> {
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

  fn write(&self, path: &Path, contents: &Vec<u8>) -> Result<()> {
    self.mem.write(path, contents)
  }

  fn remove_file(&self, path: &Path) -> Result<()> {
    self.mem.remove_file(path)
  }

  fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
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

  fn create_dir_all(&self, path: &Path) -> Result<()> {
    self.mem.create_dir_all(path)
  }

  fn stat(&self, path: &Path) -> Option<FileStat> {
    let mem_stat = self.mem.stat(path);
    if mem_stat.is_some() {
      return mem_stat;
    }
    self.os.stat(path)
  }

  fn lstat(&self, path: &Path) -> Option<FileStat> {
    let mem_stat = self.mem.lstat(path);
    if mem_stat.is_some() {
      return mem_stat;
    }
    self.os.lstat(path)
  }
}

/// A `FileSystem` decorator that records every path it touches into an [`InvalidationMap`],
/// delegating all operations to an inner file system. Used during `Parcel::new` to discover which
/// files were read while loading configuration (`.parcelrc` and its `extends` chain, `.env*`
/// files, `package.json`s, lockfiles, resolved plugins, ...) so that a change to any of them can
/// trigger a full rebuild.
///
/// Successful reads/stats are recorded as file-change invalidations. Lookups that report a missing
/// path are recorded as file-create invalidations (their *creation* should invalidate, e.g. a
/// `.parcelrc` that does not exist yet but appears later). Paths are recorded as absolute `file://`
/// URLs, so no project root is required while tracking.
pub struct TrackingFileSystem {
  inner: std::sync::Arc<dyn FileSystem>,
  invalidations: Mutex<crate::InvalidationMap>,
}

impl TrackingFileSystem {
  pub fn new(inner: std::sync::Arc<dyn FileSystem>) -> Self {
    TrackingFileSystem {
      inner,
      invalidations: Mutex::new(crate::InvalidationMap::default()),
    }
  }

  fn record_read(&self, path: &Path) {
    if let Ok(url) = crate::SourceUrl::from_absolute_path(path) {
      self
        .invalidations
        .lock()
        .unwrap()
        .on_file_change
        .entry(url)
        .or_insert_with(|| vec![0]);
    }
  }

  fn record_missing(&self, path: &Path) {
    if let Ok(url) = crate::SourceUrl::from_absolute_path(path) {
      self
        .invalidations
        .lock()
        .unwrap()
        .on_file_create_path
        .entry(url)
        .or_insert_with(|| vec![0]);
    }
  }

  /// Returns the accumulated invalidation map, leaving the tracker empty.
  pub fn take(&self) -> crate::InvalidationMap {
    std::mem::take(&mut *self.invalidations.lock().unwrap())
  }
}

impl FileSystem for TrackingFileSystem {
  fn read(&self, path: &Path) -> Result<Vec<u8>> {
    let result = self.inner.read(path);
    if matches!(&result, Err(e) if e.kind() == ErrorKind::NotFound) {
      self.record_missing(path);
    } else {
      self.record_read(path);
    }
    result
  }

  fn kind(&self, path: &Path) -> FileKind {
    let kind = self.inner.kind(path);
    if kind.is_empty() {
      self.record_missing(path);
    } else {
      self.record_read(path);
    }
    kind
  }

  fn stat(&self, path: &Path) -> Option<FileStat> {
    let stat = self.inner.stat(path);
    if stat.is_some() {
      self.record_read(path);
    } else {
      self.record_missing(path);
    }
    stat
  }

  fn lstat(&self, path: &Path) -> Option<FileStat> {
    let stat = self.inner.lstat(path);
    if stat.is_some() {
      self.record_read(path);
    } else {
      self.record_missing(path);
    }
    stat
  }

  fn read_link(&self, path: &Path) -> Result<PathBuf> {
    self.record_read(path);
    self.inner.read_link(path)
  }

  fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
    self.record_read(path);
    self.inner.read_dir(path)
  }

  fn write(&self, path: &Path, contents: &Vec<u8>) -> Result<()> {
    self.inner.write(path, contents)
  }

  fn remove_file(&self, path: &Path) -> Result<()> {
    self.inner.remove_file(path)
  }

  fn create_dir_all(&self, path: &Path) -> Result<()> {
    self.inner.create_dir_all(path)
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
  pattern.contains(&['*', '[', '{'])
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

pub fn normalize_path(path: &Path) -> PathBuf {
  // Normalize path components to resolve ".." and "." segments.
  // https://github.com/rust-lang/cargo/blob/fede83ccf973457de319ba6fa0e36ead454d2e20/src/cargo/util/paths.rs#L61
  let mut components = path.components().peekable();
  let mut ret = if let Some(c @ Component::Prefix(..)) = components.peek().cloned() {
    components.next();
    PathBuf::from(c.as_os_str())
  } else {
    PathBuf::new()
  };

  for component in components {
    match component {
      Component::Prefix(..) => unreachable!(),
      Component::RootDir => {
        ret.push(component.as_os_str());
      }
      Component::CurDir => {}
      Component::ParentDir => {
        ret.pop();
      }
      Component::Normal(c) => {
        ret.push(c);
      }
    }
  }

  // If the path ends with a separator, add an additional empty component.
  if matches!(path.as_os_str().as_encoded_bytes().last(), Some(b) if is_separator(*b as char)) {
    ret.push("");
  }

  ret
}

pub fn resolve_path(from: &Path, subpath: &Path) -> PathBuf {
  let mut path = PathBuf::new();
  if let Some(parent) = from.parent() {
    path.push(parent);
  }

  for component in subpath.components() {
    match component {
      Component::Prefix(..) | Component::RootDir => unreachable!(),
      Component::CurDir => {}
      Component::ParentDir => {
        path.pop();
      }
      Component::Normal(c) => {
        path.push(c);
      }
    }
  }

  path
}
