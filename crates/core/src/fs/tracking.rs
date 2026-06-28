use std::{
  io::{ErrorKind, Result},
  path::Path,
  sync::Mutex,
};

use crate::PathId;

use super::{DirEntry, FileKind, FileStat, FileSystem, is_glob};

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
///
/// The accumulated [`Invalidations`](crate::Invalidations) can be folded into an
/// [`InvalidationMap`](crate::InvalidationMap) (for config tracking during `Parcel::new`) or merged
/// into a transform request's invalidations (for per-asset tracking of files read by transformers).
pub struct TrackingFileSystem {
  inner: std::sync::Arc<dyn FileSystem>,
  invalidations: Mutex<crate::Invalidations>,
}

impl TrackingFileSystem {
  /// Creates a tracker that records absolute `file://` URLs. Used for config tracking during
  /// `Parcel::new`, where the project root isn't yet known.
  pub fn new(inner: std::sync::Arc<dyn FileSystem>) -> Self {
    TrackingFileSystem {
      inner,
      invalidations: Mutex::new(crate::Invalidations::default()),
    }
  }

  /// Creates a tracker that records `project://` URLs (relative to `project_root`), matching the
  /// URLs used by the asset graph. Used for per-request tracking of files read by transformers.
  pub fn with_project_root(
    inner: std::sync::Arc<dyn FileSystem>,
    _project_root: crate::SourceUrl,
  ) -> Self {
    TrackingFileSystem {
      inner,
      invalidations: Mutex::new(crate::Invalidations::default()),
    }
  }

  fn record_read(&self, path: PathId) {
    self
      .invalidations
      .lock()
      .unwrap()
      .invalidate_on_file_change
      .push(path);
  }

  fn record_missing(&self, path: PathId) {
    self
      .invalidations
      .lock()
      .unwrap()
      .invalidate_on_file_create
      .push(crate::FileCreateInvalidation::Path(path));
  }

  /// Returns the accumulated invalidations, leaving the tracker empty.
  pub fn take(&self) -> crate::Invalidations {
    std::mem::take(&mut *self.invalidations.lock().unwrap())
  }
}

impl FileSystem for TrackingFileSystem {
  fn read(&self, path: PathId) -> Result<Vec<u8>> {
    let result = self.inner.read(path);
    if matches!(&result, Err(e) if e.kind() == ErrorKind::NotFound) {
      self.record_missing(path);
    } else {
      self.record_read(path);
    }
    result
  }

  fn kind(&self, path: PathId) -> FileKind {
    let kind = self.inner.kind(path);
    if kind.is_empty() {
      self.record_missing(path);
    } else {
      self.record_read(path);
    }
    kind
  }

  fn stat(&self, path: PathId) -> Option<FileStat> {
    let stat = self.inner.stat(path);
    if stat.is_some() {
      self.record_read(path);
    } else {
      self.record_missing(path);
    }
    stat
  }

  fn lstat(&self, path: PathId) -> Option<FileStat> {
    let stat = self.inner.lstat(path);
    if stat.is_some() {
      self.record_read(path);
    } else {
      self.record_missing(path);
    }
    stat
  }

  fn read_link(&self, path: PathId) -> Result<PathId> {
    self.record_read(path);
    self.inner.read_link(path)
  }

  fn read_dir(&self, path: PathId) -> Result<Vec<DirEntry>> {
    self.record_read(path);
    self.inner.read_dir(path)
  }

  fn write(&self, path: PathId, contents: &Vec<u8>) -> Result<()> {
    self.inner.write(path, contents)
  }

  fn remove_file(&self, path: PathId) -> Result<()> {
    self.inner.remove_file(path)
  }

  fn create_dir_all(&self, path: PathId) -> Result<()> {
    self.inner.create_dir_all(path)
  }

  fn glob(&self, pattern: &str, cwd: PathId) -> Vec<PathId> {
    // Record a create-glob invalidation so that a new file matching the pattern triggers a
    // rebuild (e.g. a new entry appearing for a glob entry). The pattern is absolutized so it
    // matches the absolute paths checked during invalidation.
    if is_glob(pattern) {
      let absolute = if Path::new(pattern).is_absolute() {
        pattern.to_string()
      } else {
        cwd.with_path(|c| c.join(pattern).to_string_lossy().into_owned())
      };
      self
        .invalidations
        .lock()
        .unwrap()
        .invalidate_on_file_create
        .push(crate::FileCreateInvalidation::Glob(absolute));
    }
    // Run the actual matching against the inner file system so the directory walk isn't recorded
    // as individual file-change invalidations.
    self.inner.glob(pattern, cwd)
  }

  fn find_ancestor(
    &self,
    from: PathId,
    file_name: &Path,
    kind: FileKind,
    root: PathId,
  ) -> Option<PathId> {
    let found = self.inner.find_ancestor(from, file_name, kind, root);
    if let Some(result) = found {
      self.record_read(result);
    }

    // Record a `file_create_above` invalidation: a file named `file_name` created anywhere within
    // `above` (the directory where it was found, or the root if it wasn't) would change resolution
    // and should trigger a rebuild. Using the found directory as the boundary captures any closer
    // file appearing between `from` and the match.
    let above = found
      .as_ref()
      .and_then(|f| f.parent())
      .unwrap_or_else(|| PathId::root());
    self
      .invalidations
      .lock()
      .unwrap()
      .invalidate_on_file_create
      .push(crate::FileCreateInvalidation::FileName {
        file_name: file_name.to_string_lossy().to_string(),
        above,
      });

    found
  }

  fn as_object_cache(&self) -> Option<&dyn super::ObjectCache> {
    self.inner.as_object_cache()
  }
}
