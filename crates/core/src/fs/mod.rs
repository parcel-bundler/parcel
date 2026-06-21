use std::{
  ffi::OsString,
  io::Result,
  path::{Component, Path, PathBuf, is_separator},
};

use bitflags::bitflags;
use glob_match::glob_match;

mod cached;
mod memory;
mod tracking;
pub use cached::*;
pub use memory::*;
pub use tracking::*;

#[cfg(not(target_arch = "wasm32"))]
mod os;
#[cfg(not(target_arch = "wasm32"))]
pub use os::*;

#[cfg(not(target_arch = "wasm32"))]
mod overlay;
#[cfg(not(target_arch = "wasm32"))]
pub use overlay::*;

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

#[derive(Debug, Clone)]
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

  /// Returns the paths matching `pattern`, resolved relative to `cwd`.
  ///
  /// Implementations that track invalidations (see [`TrackingFileSystem`]) override this to record
  /// a create invalidation, so that a new file matching the pattern triggers a rebuild.
  fn glob(&self, pattern: &str, cwd: &Path) -> Vec<PathBuf> {
    glob(self, pattern, cwd)
  }

  /// Searches `from` and its ancestor directories for a file named `file_name`, returning the first
  /// match (closest to `from`), or `None` if it is not found.
  ///
  /// Implementations that track invalidations override this to record a `file_create_above`
  /// invalidation, so that a closer file appearing later triggers a rebuild.
  fn find_ancestor_file(&self, from: &Path, file_name: &str) -> Option<PathBuf> {
    for dir in from.ancestors() {
      let candidate = dir.join(file_name);
      if self.kind(&candidate).contains(FileKind::IS_FILE) {
        return Some(candidate);
      }
    }
    None
  }

  /// Returns an [`ObjectCache`] for associating lazily-computed, type-erased objects with paths
  /// (e.g. parsed config files), if this file system provides one. Decorators forward to their
  /// inner file system. Returns `None` for file systems without caching.
  fn as_object_cache(&self) -> Option<&dyn ObjectCache> {
    None
  }
}

pub fn glob<F: FileSystem + ?Sized>(fs: &F, pattern: &str, cwd: &Path) -> Vec<PathBuf> {
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

fn match_dir<F: FileSystem + ?Sized>(
  fs: &F,
  dir_path: &Path,
  pattern: &str,
  matches: &mut Vec<PathBuf>,
) {
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
