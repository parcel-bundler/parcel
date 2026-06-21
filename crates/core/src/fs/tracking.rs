use std::{
  io::{ErrorKind, Result},
  path::{Path, PathBuf},
  sync::Mutex,
};

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
  /// When set, recorded paths use the `project://` scheme (matching the asset graph's invalidation
  /// URLs). When `None`, absolute `file://` URLs are used (for config tracking, where the project
  /// root isn't known until after tracking has begun).
  project_root: Option<crate::SourceUrl>,
}

impl TrackingFileSystem {
  /// Creates a tracker that records absolute `file://` URLs. Used for config tracking during
  /// `Parcel::new`, where the project root isn't yet known.
  pub fn new(inner: std::sync::Arc<dyn FileSystem>) -> Self {
    TrackingFileSystem {
      inner,
      invalidations: Mutex::new(crate::Invalidations::default()),
      project_root: None,
    }
  }

  /// Creates a tracker that records `project://` URLs (relative to `project_root`), matching the
  /// URLs used by the asset graph. Used for per-request tracking of files read by transformers.
  pub fn with_project_root(
    inner: std::sync::Arc<dyn FileSystem>,
    project_root: crate::SourceUrl,
  ) -> Self {
    TrackingFileSystem {
      inner,
      invalidations: Mutex::new(crate::Invalidations::default()),
      project_root: Some(project_root),
    }
  }

  fn to_url(&self, path: &Path) -> Option<crate::SourceUrl> {
    match &self.project_root {
      Some(root) => crate::SourceUrl::from_path(path, root).ok(),
      None => crate::SourceUrl::from_absolute_path(path).ok(),
    }
  }

  fn to_dir_url(&self, path: &Path) -> Option<crate::SourceUrl> {
    match &self.project_root {
      Some(root) => crate::SourceUrl::from_directory_path(path, root).ok(),
      None => crate::SourceUrl::from_absolute_directory_path(path).ok(),
    }
  }

  fn record_read(&self, path: &Path) {
    if let Some(url) = self.to_url(path) {
      self
        .invalidations
        .lock()
        .unwrap()
        .invalidate_on_file_change
        .push(url);
    }
  }

  fn record_missing(&self, path: &Path) {
    if let Some(url) = self.to_url(path) {
      self
        .invalidations
        .lock()
        .unwrap()
        .invalidate_on_file_create
        .push(crate::FileCreateInvalidation::Path(url));
    }
  }

  /// Returns the accumulated invalidations, leaving the tracker empty.
  pub fn take(&self) -> crate::Invalidations {
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

  fn glob(&self, pattern: &str, cwd: &Path) -> Vec<PathBuf> {
    // Record a create-glob invalidation so that a new file matching the pattern triggers a
    // rebuild (e.g. a new entry appearing for a glob entry). The pattern is absolutized so it
    // matches the absolute paths checked during invalidation.
    if is_glob(pattern) {
      let absolute = if Path::new(pattern).is_absolute() {
        pattern.to_string()
      } else {
        cwd.join(pattern).to_string_lossy().into_owned()
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

  fn find_ancestor_file(&self, from: &Path, file_name: &str) -> Option<PathBuf> {
    let mut found = None;
    let mut found_dir = None;
    for dir in from.ancestors() {
      let candidate = dir.join(file_name);
      if self.inner.kind(&candidate).contains(FileKind::IS_FILE) {
        self.record_read(&candidate);
        found_dir = Some(dir.to_path_buf());
        found = Some(candidate);
        break;
      }
    }

    // Record a `file_create_above` invalidation: a file named `file_name` created anywhere within
    // `above` (the directory where it was found, or the root if it wasn't) would change resolution
    // and should trigger a rebuild. Using the found directory as the boundary captures any closer
    // file appearing between `from` and the match.
    let above = found_dir.unwrap_or_else(|| PathBuf::from("/"));
    if let Some(above) = self.to_dir_url(&above) {
      self
        .invalidations
        .lock()
        .unwrap()
        .invalidate_on_file_create
        .push(crate::FileCreateInvalidation::FileName {
          file_name: file_name.to_string(),
          above,
        });
    }

    found
  }

  fn as_object_cache(&self) -> Option<&dyn super::ObjectCache> {
    self.inner.as_object_cache()
  }
}
