use bitflags::bitflags;
use dashmap::{DashMap, DashSet, SharedValue};
use gxhash::GxHasher;
use xxhash_rust::xxh3::Xxh3;

#[cfg(not(target_arch = "wasm32"))]
use crate::fs::FileSystemRealPathCache;
use crate::{fs::FileKind, FileSystem};
#[cfg(not(target_arch = "wasm32"))]
use std::collections::VecDeque;
use std::{
  borrow::Cow,
  cell::UnsafeCell,
  ffi::{OsStr, OsString},
  hash::{BuildHasherDefault, Hash, Hasher},
  path::{Component, Path, PathBuf},
  sync::{Arc, OnceLock},
};

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

  ret
}

pub fn resolve_path<A: AsRef<Path>, B: AsRef<Path>>(base: A, subpath: B) -> PathBuf {
  let subpath = subpath.as_ref();
  let mut components = subpath.components().peekable();
  if subpath.is_absolute() || matches!(components.peek(), Some(Component::Prefix(..))) {
    return subpath.to_path_buf();
  }

  let mut ret = base.as_ref().to_path_buf();
  ret.pop();
  for component in subpath.components() {
    match component {
      Component::Prefix(..) | Component::RootDir => unreachable!(),
      Component::CurDir => {}
      Component::ParentDir => {
        ret.pop();
      }
      Component::Normal(c) => {
        ret.push(c);
      }
    }
  }

  ret
}

#[cfg(not(target_arch = "wasm32"))]
/// A reimplementation of std::fs::canonicalize with intermediary caching.
pub fn canonicalize(path: &Path, cache: &FileSystemRealPathCache) -> std::io::Result<PathBuf> {
  use std::ffi::{OsStr, OsString};

  let mut ret = PathBuf::new();
  let mut seen_links = 0;
  let mut queue = VecDeque::new();

  queue.push_back(path);

  while let Some(cur_path) = queue.pop_front() {
    let mut components = cur_path.components();
    for component in &mut components {
      match component {
        Component::Prefix(c) => ret.push(c.as_os_str()),
        Component::RootDir => {
          ret.push(component.as_os_str());
        }
        Component::CurDir => {}
        Component::ParentDir => {
          ret.pop();
        }
        Component::Normal(c) => {
          ret.push(c);

          // First, check the cache for the path up to this point.
          let link: &OsStr = if let Some(cached) = cache.get(ret.as_os_str()) {
            if let Some(link) = &*cached {
              // SAFETY: Keys are never removed from the cache or mutated
              // and PathBuf has a stable address for path data even when moved.
              unsafe { &*(link.as_os_str() as *const _) }
            } else {
              continue;
            }
          } else {
            let stat = std::fs::symlink_metadata(&ret)?;
            if !stat.is_symlink() {
              cache.insert(ret.clone().into_os_string(), None);
              continue;
            }

            let link = std::fs::read_link(&ret)?;
            let ptr = unsafe { &*(link.as_os_str() as *const _) };
            cache.insert(ret.clone().into_os_string(), Some(link.into_os_string()));
            ptr
          };

          seen_links += 1;
          if seen_links > 32 {
            return Err(std::io::Error::new(
              std::io::ErrorKind::NotFound,
              "Too many symlinks",
            ));
          }

          // If the link is absolute, replace the result path
          // with it, otherwise remove the last segment and
          // resolve the link components next.
          if Path::new(link).is_absolute() {
            ret = PathBuf::new();
          } else {
            ret.pop();
          }

          let remaining = components.as_path();
          if !remaining.as_os_str().is_empty() {
            queue.push_front(remaining);
          }
          queue.push_front(Path::new(link));
          break;
        }
      }
    }
  }

  Ok(ret)
}

pub struct PathInterner {
  paths: DashSet<PathEntry<'static>, BuildHasherDefault<IdentityHasher>>,
}

enum PathEntry<'a> {
  Owned(Arc<PathInfo>),
  Borrowed { hash: u64, path: &'a Path },
}

impl<'a> Hash for PathEntry<'a> {
  fn hash<H: Hasher>(&self, state: &mut H) {
    match self {
      PathEntry::Owned(info) => {
        info.hash.hash(state);
      }
      PathEntry::Borrowed { hash, .. } => {
        hash.hash(state);
      }
    }
  }
}

impl<'a> PartialEq for PathEntry<'a> {
  fn eq(&self, other: &Self) -> bool {
    let self_path = match self {
      PathEntry::Owned(info) => &info.path,
      PathEntry::Borrowed { path, .. } => *path,
    };
    let other_path = match other {
      PathEntry::Owned(info) => &info.path,
      PathEntry::Borrowed { path, .. } => *path,
    };
    self_path == other_path
  }
}

impl<'a> Eq for PathEntry<'a> {}

impl PathInterner {
  pub fn new() -> PathInterner {
    PathInterner {
      paths: DashSet::default(),
    }
  }

  pub fn get(&self, path: &Path) -> InternedPath {
    let mut hasher = GxHasher::default();
    path.as_os_str().hash(&mut hasher);
    let hash = hasher.finish();

    let key = PathEntry::Borrowed { hash, path };

    // A DashMap is just an array of RwLock<HashSet>, sharded by hash to reduce lock contention.
    // This uses the low level raw API to avoid cloning the value when using the `entry` method.
    // First, find which shard the value is in, and check to see if we already have a value in the map.
    let shard = self.paths.determine_shard(hash as usize);
    {
      // Scope the read lock.
      let map = self.paths.shards()[shard].read();
      if let Some((PathEntry::Owned(entry), _)) = map.get(hash, |v| v.0 == key) {
        return InternedPath(Arc::clone(entry));
      }
    }

    // If that wasn't found, we need to create a new entry.
    let info = Arc::new(PathInfo {
      hash,
      path: path.to_path_buf(),
      parent: path
        .parent()
        .map(|p| InternedPath(Arc::clone(&self.get(p).0))),
      kind: OnceLock::new(),
      canonical: OnceLock::new(),
    });

    self.paths.insert(PathEntry::Owned(Arc::clone(&info)));
    InternedPath(info)
  }
}

struct PathInfo {
  hash: u64,
  path: PathBuf,
  parent: Option<InternedPath>,
  kind: OnceLock<FileKind>,
  canonical: OnceLock<PathBuf>,
}

#[derive(Clone)]
pub struct InternedPath(Arc<PathInfo>);

impl InternedPath {
  pub fn as_path(&self) -> &Path {
    self.0.path.as_path()
  }

  pub fn parent(&self) -> Option<&InternedPath> {
    self.0.parent.as_ref()
  }

  fn kind(&self, fs: &dyn FileSystem) -> FileKind {
    *self.0.kind.get_or_init(|| fs.kind(self.as_path()))
  }

  pub fn is_file(&self, fs: &dyn FileSystem) -> bool {
    self.kind(fs).contains(FileKind::IS_FILE)
  }

  pub fn is_dir(&self, fs: &dyn FileSystem) -> bool {
    self.kind(fs).contains(FileKind::IS_DIR)
  }

  pub fn is_symlink(&self, fs: &dyn FileSystem) -> bool {
    self.kind(fs).contains(FileKind::IS_SYMLINK)
  }

  pub fn canonicalize(&self, fs: &dyn FileSystem) -> PathBuf {
    self
      .0
      .canonical
      .get_or_init(|| {
        if self.is_symlink(fs) {
          let mut path = Cow::Borrowed(self.as_path());
          loop {
            let resolved = resolve_link(&path);
            if std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_symlink()) {
              path = Cow::Owned(resolved);
            } else {
              break;
            }
          }

          path.into_owned()
        } else {
          self
            .parent()
            .map(|p| {
              p.canonicalize(fs)
                .join(self.as_path().strip_prefix(p.as_path()).unwrap())
            })
            .unwrap_or(PathBuf::default())
        }
      })
      .clone()
  }

  pub fn ancestors<'a>(&'a self) -> impl Iterator<Item = &'a InternedPath> {
    std::iter::successors(self.parent(), |p| p.parent())
  }

  pub fn file_name(&self) -> Option<&OsStr> {
    self.as_path().file_name()
  }

  pub fn extension(&self) -> Option<&OsStr> {
    self.as_path().extension()
  }

  pub fn join(&self, segment: &str, interner: &PathInterner) -> InternedPath {
    SCRATCH_PATH.with(|path| {
      let path = unsafe { &mut *path.get() };
      path.clear();
      path.as_mut_os_string().push(self.as_path().as_os_str());
      path.push(segment);
      interner.get(path)
    })
  }

  pub fn join_module(&self, module: &str, interner: &PathInterner) -> InternedPath {
    SCRATCH_PATH.with(|path| {
      let path = unsafe { &mut *path.get() };
      path.clear();
      path.as_mut_os_string().push(self.as_path().as_os_str());
      path.push("node_modules");
      path.push(module);
      interner.get(path)
    })
  }

  pub fn resolve(&self, subpath: &Path, interner: &PathInterner) -> InternedPath {
    SCRATCH_PATH.with(|path| {
      let path = unsafe { &mut *path.get() };
      path.clear();
      if let Some(parent) = self.0.parent.as_ref() {
        path.as_mut_os_string().push(parent.0.path.as_os_str());
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

      interner.get(path)
    })
  }

  pub fn add_extension(&self, ext: &str, interner: &PathInterner) -> InternedPath {
    SCRATCH_PATH.with(|path| {
      let path = unsafe { &mut *path.get() };
      path.clear();
      let s = path.as_mut_os_string();
      s.push(self.as_path().as_os_str());
      s.push(".");
      s.push(ext);
      interner.get(path)
    })
  }
}

struct ScratchData {
  buf: Vec<u8>,
  last: *const PathInfo,
}

impl ScratchData {
  const fn new() -> ScratchData {
    ScratchData {
      buf: Vec::new(),
      last: std::ptr::null(),
    }
  }

  fn update<R, F: FnOnce(&mut PathBuf) -> R>(&mut self, info: &Arc<PathInfo>, f: F) -> R {
    let ptr = Arc::as_ptr(info);
    if self.last != ptr {
      self.buf.clear();
      self
        .buf
        .extend_from_slice(info.path.as_os_str().as_encoded_bytes());
      self.last = ptr;
    } else {
      self
        .buf
        .truncate(info.path.as_os_str().as_encoded_bytes().len());
    }

    let str = unsafe { OsString::from_encoded_bytes_unchecked(std::mem::take(&mut self.buf)) };
    let mut path = PathBuf::from(str);

    let res = f(&mut path);

    self.buf = path.into_os_string().into_encoded_bytes();
    res
  }
}

thread_local! {
  pub static SCRATCH_PATH: UnsafeCell<PathBuf> = UnsafeCell::new(PathBuf::new());
}

fn resolve_link(path: &Path) -> PathBuf {
  if let Ok(link) = std::fs::read_link(path) {
    if link.is_absolute() {
      return normalize_path(&link);
    } else {
      let mut buf = path.to_path_buf();
      buf.pop();
      for component in link.components() {
        match component {
          Component::ParentDir => {
            buf.pop();
          }
          Component::Normal(name) => {
            buf.push(name);
          }
          Component::RootDir => {
            buf.push(component.as_os_str());
          }
          Component::CurDir | Component::Prefix(..) => {}
        }
      }
      buf
    }
  } else {
    path.to_path_buf()
  }
}

impl Hash for InternedPath {
  fn hash<H: Hasher>(&self, state: &mut H) {
    self.0.hash.hash(state);
  }
}

impl PartialEq for InternedPath {
  fn eq(&self, other: &Self) -> bool {
    // Interned values always point to unique values, so we only need to compare the pointers.
    std::ptr::eq(Arc::as_ptr(&self.0), Arc::as_ptr(&other.0))
  }
}

impl Eq for InternedPath {}

impl std::fmt::Debug for InternedPath {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.0.path.fmt(f)
  }
}

impl Default for InternedPath {
  fn default() -> Self {
    static DEFAULT: OnceLock<Arc<PathInfo>> = OnceLock::new();
    let arc = DEFAULT.get_or_init(|| {
      let path = PathBuf::default();
      let mut hasher = GxHasher::default();
      path.as_os_str().hash(&mut hasher);
      let hash = hasher.finish();
      Arc::new(PathInfo {
        hash,
        path,
        parent: None,
        kind: OnceLock::new(),
        canonical: OnceLock::new(),
      })
    });
    InternedPath(Arc::clone(arc))
  }
}

/// A hasher that just passes through a value that is already a hash.
#[derive(Default)]
pub struct IdentityHasher {
  hash: u64,
}

impl Hasher for IdentityHasher {
  fn write(&mut self, bytes: &[u8]) {
    if bytes.len() == 8 {
      self.hash = u64::from_ne_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
      ])
    } else {
      unreachable!()
    }
  }

  fn finish(&self) -> u64 {
    self.hash
  }
}

#[cfg(test)]
mod test {
  use super::*;
  use assert_fs::prelude::*;
  use dashmap::DashMap;

  #[test]
  fn test_canonicalize() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(windows)]
    if !is_elevated::is_elevated() {
      println!("skipping symlink tests due to missing permissions");
      return Ok(());
    }

    let dir = assert_fs::TempDir::new()?;
    dir.child("foo/bar.js").write_str("")?;
    dir.child("root.js").write_str("")?;

    dir
      .child("symlink")
      .symlink_to_file(Path::new("foo").join("bar.js"))?;
    dir
      .child("foo/symlink")
      .symlink_to_file(Path::new("..").join("root.js"))?;
    dir
      .child("absolute")
      .symlink_to_file(dir.child("root.js").path())?;
    dir
      .child("recursive")
      .symlink_to_file(Path::new("foo").join("symlink"))?;
    dir.child("cycle").symlink_to_file("cycle1")?;
    dir.child("cycle1").symlink_to_file("cycle")?;
    dir.child("a/b/c").create_dir_all()?;
    dir.child("a/b/e").symlink_to_file("..")?;
    dir.child("a/d").symlink_to_file("..")?;
    dir.child("a/b/c/x.txt").write_str("")?;
    dir
      .child("a/link")
      .symlink_to_file(dir.child("a/b").path())?;

    println!("{:?}", std::fs::symlink_metadata(dir.child("a/b/c/x.txt")));

    let cache = DashMap::default();

    assert_eq!(
      canonicalize(dir.child("symlink").path(), &cache)?,
      canonicalize(dir.child("foo/bar.js").path(), &cache)?
    );
    assert_eq!(
      canonicalize(dir.child("foo/symlink").path(), &cache)?,
      canonicalize(dir.child("root.js").path(), &cache)?
    );
    assert_eq!(
      canonicalize(dir.child("absolute").path(), &cache)?,
      canonicalize(dir.child("root.js").path(), &cache)?
    );
    assert_eq!(
      canonicalize(dir.child("recursive").path(), &cache)?,
      canonicalize(dir.child("root.js").path(), &cache)?
    );
    assert!(canonicalize(dir.child("cycle").path(), &cache).is_err());
    assert_eq!(
      canonicalize(dir.child("a/b/e/d/a/b/e/d/a").path(), &cache)?,
      canonicalize(dir.child("a").path(), &cache)?
    );
    assert_eq!(
      canonicalize(dir.child("a/link/c/x.txt").path(), &cache)?,
      canonicalize(dir.child("a/b/c/x.txt").path(), &cache)?
    );

    Ok(())
  }
}
