use std::{
  any::{Any, TypeId},
  hash::BuildHasherDefault,
  io::{Error, ErrorKind, Result},
  sync::{
    Arc, OnceLock,
    atomic::{AtomicU64, Ordering},
  },
};

use rustc_hash::FxHasher;

use crate::PathId;

use super::{DirEntry, FileKind, FileStat, FileSystem};

/// A cache that associates arbitrary, lazily-computed objects with a path, sharing the lifetime and
/// invalidation of the underlying [`CachedFileSystem`]. Used to cache parsed artifacts derived from
/// files (e.g. `package.json`, `tsconfig.json`) without the fs layer knowing their concrete types.
///
/// Obtain one via [`FileSystem::as_object_cache`]; prefer the generic [`get_or_compute`] helper on
/// `dyn ObjectCache` over calling `object` directly.
///
/// [`get_or_compute`]: #method.get_or_compute
pub trait ObjectCache {
  /// Returns the object of the given type associated with `path`, computing and storing it via
  /// `compute` if absent. The computation runs at most once per `(path, type)`.
  fn object(
    &self,
    path: PathId,
    type_id: TypeId,
    compute: &mut dyn FnMut() -> Arc<dyn Any + Send + Sync>,
  ) -> Arc<dyn Any + Send + Sync>;
}

impl dyn ObjectCache + '_ {
  /// Returns the `T` associated with `path`, computing and caching it with `f` if absent.
  pub fn get_or_compute<T: Any + Send + Sync>(
    &self,
    path: PathId,
    f: impl FnOnce() -> Arc<T>,
  ) -> Arc<T> {
    let mut f = Some(f);
    let value = self.object(path, TypeId::of::<T>(), &mut || {
      let value: Arc<dyn Any + Send + Sync> = (f.take().expect("compute called twice"))();
      value
    });
    value
      .downcast::<T>()
      .expect("object type mismatch for cached path")
  }
}

/// A `FileSystem` decorator that memoizes filesystem metadata lookups in a concurrent cache,
/// delegating misses to an inner file system. A single instance can be shared across the whole
/// build so the resolver, transformers, and the JS environment all read through the same warm
/// cache, and stale entries are dropped centrally via [`CachedFileSystem::invalidate`].
///
/// Only metadata operations are cached (`kind`, `stat`, `lstat`, `read_dir`, `read_link`,
/// `canonicalize`) — exactly the lookups hammered during resolution. File *contents* (`read`) are
/// passed straight through, since caching them would duplicate every source file in memory.
///
/// The path-interning machinery (a `papaya` set keyed by a pre-hashed path, with allocation-free
/// borrowed lookups) is adapted from `parcel-resolver`'s cache, minus the parsed `package.json` /
/// `tsconfig` structures and node_modules bookkeeping it doesn't need here.
pub struct CachedFileSystem {
  inner: Arc<dyn FileSystem>,
  paths: papaya::HashMap<PathId, PathEntry>,
}

/// A lazily-computed, type-erased value derived from a path (e.g. a parsed `package.json`).
type CachedObject = Arc<OnceLock<Arc<dyn Any + Send + Sync>>>;

/// Cached metadata for a single path. Each field is computed at most once; `Result`-returning
/// operations are only cached on success (errors are rare and re-tried against the inner fs).
struct CacheEntry {
  kind: OnceLock<FileKind>,
  stat: OnceLock<Option<FileStat>>,
  lstat: OnceLock<Option<FileStat>>,
  read_dir: OnceLock<Arc<Vec<DirEntry>>>,
  read_link: OnceLock<PathId>,
  canonical: OnceLock<PathId>,
  /// The id of the thread currently canonicalizing this path (0 if none), used to detect circular
  /// symlinks: re-entering canonicalization of the same path on the same thread is a cycle.
  canonicalizing: AtomicU64,
  /// Arbitrary objects derived from this path, keyed by their type. Stored type-erased so the fs
  /// layer needn't know about resolver concepts like `package.json` or `tsconfig`. Dropped together
  /// with the entry on invalidation, which is how derived artifacts get invalidated centrally.
  objects: papaya::HashMap<TypeId, CachedObject, BuildHasherDefault<FxHasher>>,
}

/// An entry in the path set. Hashed by its precomputed path hash and compared by path, so lookups
/// can borrow a `&Path` without allocating (see [`BorrowedPathEntry`]).
struct PathEntry(Arc<CacheEntry>);

#[cfg(not(target_arch = "wasm32"))]
impl Default for CachedFileSystem {
  fn default() -> Self {
    CachedFileSystem::new(Arc::new(super::OsFileSystem))
  }
}

impl CachedFileSystem {
  /// Creates an empty cache wrapping the given file system.
  pub fn new(inner: Arc<dyn FileSystem>) -> CachedFileSystem {
    CachedFileSystem {
      inner,
      paths: papaya::HashMap::default(),
    }
  }

  /// The underlying (uncached) file system.
  pub fn inner(&self) -> &Arc<dyn FileSystem> {
    &self.inner
  }

  /// Returns the cache entry for `path`, creating it if necessary.
  fn entry(&self, path: PathId) -> Arc<CacheEntry> {
    let paths = self.paths.pin();
    if let Some(PathEntry(entry)) = paths.get(&path) {
      return entry.clone();
    }

    let entry = Arc::new(CacheEntry {
      kind: OnceLock::new(),
      stat: OnceLock::new(),
      lstat: OnceLock::new(),
      read_dir: OnceLock::new(),
      read_link: OnceLock::new(),
      canonical: OnceLock::new(),
      canonicalizing: AtomicU64::new(0),
      objects: papaya::HashMap::default(),
    });
    // A concurrent insert of the same path is harmless: `insert` keeps the existing entry and this
    // caller simply uses its own (which won't be shared), recomputing at most once.
    paths.insert(path, PathEntry(entry.clone()));
    entry
  }

  /// Drops cached metadata for the given paths (e.g. when files change). For each path, the entry
  /// itself and its parent directory's entry are removed — the latter because a created or deleted
  /// child changes the parent's `read_dir` result.
  pub fn invalidate(&self, paths: impl IntoIterator<Item = PathId>) {
    let entries = self.paths.pin();
    for path in paths {
      entries.remove(&path);
      if let Some(parent) = path.parent() {
        entries.remove(&parent);
      }
    }
  }

  /// Removes all cached entries.
  pub fn clear(&self) {
    self.paths.pin().clear();
  }
}

impl FileSystem for CachedFileSystem {
  fn read(&self, path: PathId) -> Result<Vec<u8>> {
    // Contents are not cached (would duplicate every source file in memory).
    self.inner.read(path)
  }

  fn kind(&self, path: PathId) -> FileKind {
    *self.entry(path).kind.get_or_init(|| self.inner.kind(path))
  }

  fn stat(&self, path: PathId) -> Option<FileStat> {
    self
      .entry(path)
      .stat
      .get_or_init(|| self.inner.stat(path))
      .clone()
  }

  fn lstat(&self, path: PathId) -> Option<FileStat> {
    self
      .entry(path)
      .lstat
      .get_or_init(|| self.inner.lstat(path))
      .clone()
  }

  fn read_link(&self, path: PathId) -> Result<PathId> {
    let entry = self.entry(path);
    if let Some(link) = entry.read_link.get() {
      return Ok(*link);
    }
    let result = self.inner.read_link(path)?;
    let _ = entry.read_link.set(result);
    Ok(result)
  }

  fn read_dir(&self, path: PathId) -> Result<Vec<DirEntry>> {
    let entry = self.entry(path);
    if let Some(entries) = entry.read_dir.get() {
      return Ok((**entries).clone());
    }
    let result = self.inner.read_dir(path)?;
    let _ = entry.read_dir.set(Arc::new(result.clone()));
    Ok(result)
  }

  fn canonicalize(&self, path: PathId) -> Result<PathId> {
    // Resolve symlinks one level at a time, caching the canonical path of each ancestor. Sibling
    // paths under a common directory then share that directory's cached canonical result instead of
    // re-resolving the whole prefix every time (which is what delegating to a single OS
    // `canonicalize` call would do).
    let entry = self.entry(path);
    if let Some(canonical) = entry.canonical.get() {
      return Ok(*canonical);
    }

    // Detect circular symlinks: if this thread is already canonicalizing this entry, it's a cycle.
    let tid = THREAD_ID.with(|t| *t);
    if entry.canonicalizing.load(Ordering::Acquire) == tid {
      return Err(Error::new(ErrorKind::NotFound, "circular symlink"));
    }
    entry.canonicalizing.store(tid, Ordering::Release);

    let result = (|| {
      let Some(parent) = path.parent() else {
        // Root has no parent; it is its own canonical path.
        return Ok(path);
      };
      let parent_canonical = self.canonicalize(parent)?;
      // Since `parent` is `path`'s parent, the suffix is exactly `path`'s final segment — append it
      // to the canonicalized parent. No prefix stripping needed.
      let resolved = parent_canonical.child(path.file_name());

      if entry
        .kind
        .get_or_init(|| self.inner.kind(path))
        .contains(FileKind::IS_SYMLINK)
      {
        // `read_link` returns the already-absolute target, so just canonicalize it.
        self.canonicalize(self.read_link(resolved)?)
      } else {
        Ok(resolved)
      }
    })();

    entry.canonicalizing.store(0, Ordering::Release);
    if let Ok(canonical) = &result {
      let _ = entry.canonical.set(*canonical);
    }
    result
  }

  fn write(&self, path: PathId, contents: &[u8]) -> Result<()> {
    self.inner.write(path, contents)?;
    self.invalidate([path]);
    Ok(())
  }

  fn remove_file(&self, path: PathId) -> Result<()> {
    self.inner.remove_file(path)?;
    self.invalidate([path]);
    Ok(())
  }

  fn create_dir_all(&self, path: PathId) -> Result<()> {
    self.inner.create_dir_all(path)?;
    self.invalidate([path]);
    Ok(())
  }

  fn as_object_cache(&self) -> Option<&dyn ObjectCache> {
    Some(self)
  }
}

impl ObjectCache for CachedFileSystem {
  fn object(
    &self,
    path: PathId,
    type_id: TypeId,
    compute: &mut dyn FnMut() -> Arc<dyn Any + Send + Sync>,
  ) -> Arc<dyn Any + Send + Sync> {
    let entry = self.entry(path);
    let slot = entry
      .objects
      .pin()
      .get_or_insert_with(type_id, || Arc::new(OnceLock::new()))
      .clone();
    slot.get_or_init(|| compute()).clone()
  }
}

static THREAD_COUNT: AtomicU64 = AtomicU64::new(1);

thread_local! {
  /// A unique non-zero id per thread, used by `canonicalize` for circular-symlink detection.
  static THREAD_ID: u64 = THREAD_COUNT.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::{MemoryFileSystem, normalize_path, resolve_path};
  use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
  };

  /// An inner file system that counts how many times each cached operation reaches it.
  struct CountingFileSystem {
    inner: MemoryFileSystem,
    kind_calls: AtomicUsize,
    read_dir_calls: AtomicUsize,
    read_calls: AtomicUsize,
  }

  impl CountingFileSystem {
    fn new() -> Self {
      CountingFileSystem {
        inner: MemoryFileSystem::new(),
        kind_calls: AtomicUsize::new(0),
        read_dir_calls: AtomicUsize::new(0),
        read_calls: AtomicUsize::new(0),
      }
    }
  }

  impl FileSystem for CountingFileSystem {
    fn read(&self, path: PathId) -> Result<Vec<u8>> {
      self.read_calls.fetch_add(1, Ordering::Relaxed);
      self.inner.read(path)
    }
    fn kind(&self, path: PathId) -> FileKind {
      self.kind_calls.fetch_add(1, Ordering::Relaxed);
      self.inner.kind(path)
    }
    fn stat(&self, path: PathId) -> Option<FileStat> {
      self.inner.stat(path)
    }
    fn lstat(&self, path: PathId) -> Option<FileStat> {
      self.inner.lstat(path)
    }
    fn read_link(&self, path: PathId) -> Result<PathId> {
      self.inner.read_link(path)
    }
    fn read_dir(&self, path: PathId) -> Result<Vec<DirEntry>> {
      self.read_dir_calls.fetch_add(1, Ordering::Relaxed);
      self.inner.read_dir(path)
    }
    fn write(&self, path: PathId, contents: &[u8]) -> Result<()> {
      self.inner.write(path, contents)
    }
    fn remove_file(&self, path: PathId) -> Result<()> {
      self.inner.remove_file(path)
    }
    fn create_dir_all(&self, path: PathId) -> Result<()> {
      self.inner.create_dir_all(path)
    }
  }

  /// Interns a path string for use in tests.
  fn pid(s: &str) -> PathId {
    PathId::new(Path::new(s))
  }

  fn setup() -> (Arc<CountingFileSystem>, CachedFileSystem) {
    let counting = Arc::new(CountingFileSystem::new());
    let fs = CachedFileSystem::new(counting.clone());
    fs.create_dir_all(pid("/dir")).unwrap();
    fs.write(pid("/dir/a.js"), &b"a".to_vec()).unwrap();
    fs.write(pid("/dir/b.js"), &b"b".to_vec()).unwrap();
    (counting, fs)
  }

  #[test]
  fn caches_kind_until_invalidated() {
    let (counting, fs) = setup();
    let path = pid("/dir/a.js");

    assert!(fs.kind(path).contains(FileKind::IS_FILE));
    assert!(fs.kind(path).contains(FileKind::IS_FILE));
    assert_eq!(
      counting.kind_calls.load(Ordering::Relaxed),
      1,
      "second kind() should hit cache"
    );

    fs.invalidate([path]);
    assert!(fs.kind(path).contains(FileKind::IS_FILE));
    assert_eq!(
      counting.kind_calls.load(Ordering::Relaxed),
      2,
      "invalidation should force a refetch"
    );
  }

  #[test]
  fn caches_read_dir() {
    let (counting, fs) = setup();
    let dir = pid("/dir");

    assert_eq!(fs.read_dir(dir).unwrap().len(), 2);
    assert_eq!(fs.read_dir(dir).unwrap().len(), 2);
    assert_eq!(counting.read_dir_calls.load(Ordering::Relaxed), 1);
  }

  #[test]
  fn creating_a_file_invalidates_parent_listing() {
    let (counting, fs) = setup();
    let dir = pid("/dir");

    assert_eq!(fs.read_dir(dir).unwrap().len(), 2);

    // Writing a new file goes through the cache, which invalidates the parent directory's listing.
    fs.write(pid("/dir/c.js"), &b"c".to_vec()).unwrap();
    assert_eq!(fs.read_dir(dir).unwrap().len(), 3);
    assert_eq!(counting.read_dir_calls.load(Ordering::Relaxed), 2);
  }

  #[test]
  fn caches_objects_until_invalidated() {
    let (_counting, fs) = setup();
    let path = pid("/dir/a.js");
    let cache = fs
      .as_object_cache()
      .expect("CachedFileSystem provides an object cache");
    let computes = AtomicUsize::new(0);
    // The closure counts only when actually invoked (i.e. on a cache miss).
    let count = || computes.fetch_add(1, Ordering::Relaxed);

    let v1 = cache.get_or_compute::<String>(path, || {
      count();
      Arc::new("hello".to_string())
    });
    let v2 = cache.get_or_compute::<String>(path, || {
      count();
      Arc::new("ignored".to_string())
    });
    assert_eq!(*v1, "hello");
    assert_eq!(*v2, "hello", "second call returns the cached object");
    assert_eq!(
      computes.load(Ordering::Relaxed),
      1,
      "compute runs at most once"
    );

    // Invalidating the path drops the associated object, so it is recomputed.
    fs.invalidate([path]);
    let v3 = cache.get_or_compute::<String>(path, || {
      count();
      Arc::new("again".to_string())
    });
    assert_eq!(*v3, "again");
    assert_eq!(computes.load(Ordering::Relaxed), 2);
  }

  #[test]
  fn caches_objects_per_type() {
    let (_counting, fs) = setup();
    let path = pid("/dir/a.js");
    let cache = fs.as_object_cache().unwrap();

    let s = cache.get_or_compute::<String>(path, || Arc::new("text".to_string()));
    let n = cache.get_or_compute::<u32>(path, || Arc::new(42u32));
    assert_eq!(*s, "text");
    assert_eq!(
      *n, 42,
      "different types are stored independently for the same path"
    );
  }

  #[test]
  fn does_not_cache_read() {
    let (counting, fs) = setup();
    let path = pid("/dir/a.js");

    assert_eq!(fs.read(path).unwrap(), b"a");
    assert_eq!(fs.read(path).unwrap(), b"a");
    assert_eq!(
      counting.read_calls.load(Ordering::Relaxed),
      2,
      "file contents are intentionally not cached"
    );
  }

  /// A mock file system with an explicit symlink table, for testing incremental canonicalization
  /// deterministically (without touching the real file system).
  struct SymlinkFileSystem {
    links: std::collections::HashMap<PathBuf, PathBuf>,
    read_link_calls: AtomicUsize,
  }

  impl FileSystem for SymlinkFileSystem {
    fn read(&self, _path: PathId) -> Result<Vec<u8>> {
      Err(Error::new(ErrorKind::NotFound, "unsupported"))
    }
    fn kind(&self, path: PathId) -> FileKind {
      path.with_path(|path| {
        if self.links.contains_key(path) {
          FileKind::IS_FILE | FileKind::IS_SYMLINK
        } else {
          FileKind::IS_DIR
        }
      })
    }
    fn stat(&self, _path: PathId) -> Option<FileStat> {
      None
    }
    fn lstat(&self, _path: PathId) -> Option<FileStat> {
      None
    }
    fn read_link(&self, path: PathId) -> Result<PathId> {
      self.read_link_calls.fetch_add(1, Ordering::Relaxed);
      path.with_path(|path| {
        let target = self
          .links
          .get(path)
          .ok_or_else(|| Error::new(ErrorKind::NotFound, "not a symlink"))?;
        // Resolve relative link targets against the link's directory, matching `OsFileSystem`.
        let resolved = if target.is_absolute() {
          normalize_path(target)
        } else {
          resolve_path(path, target)
        };
        Ok(PathId::new(&resolved))
      })
    }
    fn read_dir(&self, _path: PathId) -> Result<Vec<DirEntry>> {
      Ok(Vec::new())
    }
    fn write(&self, _path: PathId, _contents: &[u8]) -> Result<()> {
      Ok(())
    }
    fn remove_file(&self, _path: PathId) -> Result<()> {
      Ok(())
    }
    fn create_dir_all(&self, _path: PathId) -> Result<()> {
      Ok(())
    }
  }

  fn symlink_fs(links: &[(&str, &str)]) -> (Arc<SymlinkFileSystem>, CachedFileSystem) {
    let links = links
      .iter()
      .map(|(from, to)| (PathBuf::from(from), PathBuf::from(to)))
      .collect();
    let inner = Arc::new(SymlinkFileSystem {
      links,
      read_link_calls: AtomicUsize::new(0),
    });
    let fs = CachedFileSystem::new(inner.clone());
    (inner, fs)
  }

  #[test]
  fn canonicalize_resolves_absolute_symlink() {
    let (_inner, fs) = symlink_fs(&[("/link_dir", "/real_dir")]);
    assert_eq!(
      fs.canonicalize(pid("/link_dir/a")).unwrap(),
      pid("/real_dir/a")
    );
  }

  #[test]
  fn canonicalize_resolves_relative_symlink() {
    let (_inner, fs) = symlink_fs(&[("/dir/link", "../target")]);
    assert_eq!(fs.canonicalize(pid("/dir/link")).unwrap(), pid("/target"));
  }

  #[test]
  fn canonicalize_reuses_cached_parent() {
    let (inner, fs) = symlink_fs(&[("/link_dir", "/real_dir")]);
    assert_eq!(
      fs.canonicalize(pid("/link_dir/a")).unwrap(),
      pid("/real_dir/a")
    );
    assert_eq!(
      fs.canonicalize(pid("/link_dir/b")).unwrap(),
      pid("/real_dir/b")
    );
    // The shared parent symlink is resolved once; the second call reuses its cached canonical path.
    assert_eq!(inner.read_link_calls.load(Ordering::Relaxed), 1);
  }

  #[test]
  fn canonicalize_detects_circular_symlinks() {
    let (_inner, fs) = symlink_fs(&[("/a", "/b"), ("/b", "/a")]);
    assert!(
      fs.canonicalize(pid("/a")).is_err(),
      "a circular symlink must error rather than loop forever"
    );
  }
}
