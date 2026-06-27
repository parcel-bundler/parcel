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

use crate::PathId;

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
///
/// All methods operate on interned [`PathId`]s rather than `&Path`. Leaf implementations
/// (`OsFileSystem`, `MemoryFileSystem`, ...) materialize the path once at the boundary via
/// [`PathId::with_path`]; decorators (`CachedFileSystem`, `TrackingFileSystem`, ...) stay entirely
/// in `PathId` space, so a path is interned once and threaded as a cheap `Copy` handle throughout.
pub trait FileSystem: Send + Sync {
  /// Reads the given path as a byte vector.
  fn read(&self, path: PathId) -> Result<Vec<u8>>;

  /// Reads the given path as a string
  fn read_to_string(&self, path: PathId) -> Result<String> {
    String::from_utf8(self.read(path)?).map_err(|e| std::io::Error::other(e))
  }

  /// Returns the kind of file or directory that the given path represents.
  fn kind(&self, path: PathId) -> FileKind;

  /// Returns detailed metadata about the file, following symlinks.
  fn stat(&self, path: PathId) -> Option<FileStat>;

  /// Returns detailed metadata about the file, without following symlinks.
  fn lstat(&self, path: PathId) -> Option<FileStat>;

  /// Resolves a symbolic link, returning the (absolute) target as an interned path. Relative link
  /// targets are resolved against the link's directory by the implementation, so the result is
  /// always an absolute path that can be interned and canonicalized directly.
  fn read_link(&self, path: PathId) -> Result<PathId>;

  /// Returns the canonical path, resolving every symlink in the path.
  ///
  /// Resolves one component at a time: canonicalize the parent, then append this path's final
  /// segment. Because the parent is already canonical, the suffix is exactly `path`'s file name, so
  /// no prefix-stripping is needed. If the path is a symlink, follow it (its target is already
  /// absolute, see [`read_link`](Self::read_link)) and canonicalize that.
  fn canonicalize(&self, path: PathId) -> Result<PathId> {
    let Some(parent) = path.parent() else {
      // Root has no parent; it is its own canonical path.
      return Ok(path);
    };
    let parent_canonical = self.canonicalize(parent)?;
    let resolved = parent_canonical.child(path.file_name());

    if self.kind(path).contains(FileKind::IS_SYMLINK) {
      self.canonicalize(self.read_link(resolved)?)
    } else {
      Ok(resolved)
    }
  }

  fn write(&self, path: PathId, contents: &Vec<u8>) -> Result<()>;

  fn copy(&self, from: PathId, to: PathId) -> Result<()> {
    self.write(to, &self.read(from)?)
  }

  fn remove_file(&self, path: PathId) -> Result<()>;

  fn read_dir(&self, path: PathId) -> Result<Vec<DirEntry>>;

  fn create_dir_all(&self, path: PathId) -> Result<()>;

  /// Returns the paths matching `pattern`, resolved relative to `cwd`.
  ///
  /// Implementations that track invalidations (see [`TrackingFileSystem`]) override this to record
  /// a create invalidation, so that a new file matching the pattern triggers a rebuild.
  fn glob(&self, pattern: &str, cwd: PathId) -> Vec<PathId> {
    glob(self, pattern, cwd)
  }

  /// Searches `from` and its ancestor directories for a file named `file_name`, returning the first
  /// match (closest to `from`), or `None` if it is not found.
  ///
  /// Implementations that track invalidations override this to record a `file_create_above`
  /// invalidation, so that a closer file appearing later triggers a rebuild.
  fn find_ancestor(
    &self,
    from: PathId,
    file_name: &Path,
    kind: FileKind,
    root: PathId,
  ) -> Option<PathId> {
    for dir in from.ancestors() {
      // Break if we hit a node_modules directory
      // if let Some(filename) = dir.file_name() {
      //   if filename == "node_modules" {
      //     break;
      //   }
      // }

      let candidate = dir.join(file_name);
      if self.kind(candidate).contains(kind) {
        return Some(candidate);
      }

      if dir == root {
        break;
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

pub fn glob<F: FileSystem + ?Sized>(fs: &F, pattern: &str, cwd: PathId) -> Vec<PathId> {
  // Resolves a non-glob path segment (which may be absolute, relative, or empty) against `cwd`.
  let resolve = |segment: &str| -> PathId {
    let p = Path::new(segment);
    if segment.is_empty() {
      cwd
    } else if p.is_absolute() {
      PathId::new(p)
    } else {
      cwd.join(p)
    }
  };

  if !is_glob(pattern) {
    let path = resolve(pattern);
    if !fs.kind(path).is_empty() {
      return vec![path];
    }
    return Vec::new();
  }

  let (dir, file) = pattern.rsplit_once('/').unwrap_or(("", pattern));
  let mut matches = Vec::new();

  if !is_glob(dir) {
    match_dir(fs, resolve(dir), file, &mut matches);
  } else {
    for dir in glob(fs, dir, cwd) {
      match_dir(fs, dir, file, &mut matches)
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
  dir_path: PathId,
  pattern: &str,
  matches: &mut Vec<PathId>,
) {
  if let Ok(mut entries) = fs.read_dir(dir_path) {
    let is_globstar = pattern == "**";
    if is_globstar {
      matches.push(dir_path);
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));

    for entry in entries {
      if let Some(name) = entry.name.to_str() {
        if is_globstar {
          if entry.kind.contains(FileKind::IS_DIR) {
            match_dir(fs, dir_path.child(name), pattern, matches);
          } else {
            matches.push(dir_path.child(name));
          }
        } else if glob_match(pattern, name) {
          matches.push(dir_path.child(name));
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
