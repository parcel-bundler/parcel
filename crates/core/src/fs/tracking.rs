use std::{
  io::{ErrorKind, Result},
  sync::Mutex,
};

use thread_local::ThreadLocal;

use crate::{Invalidations, PathId, path::SubPath};

use super::{DirEntry, FileKind, FileStat, FileSystem, is_glob, normalize_path};

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
/// Resolution probes the same paths over and over, and JS runtimes on every thread load the same
/// modules, so `take` drops repeats.
///
/// Any number of threads may record at once: each appends to its own list, so they don't contend,
/// and `take` merges them.
///
/// The accumulated [`Invalidations`](crate::Invalidations) can be folded into an
/// [`InvalidationMap`](crate::InvalidationMap) (for config tracking during `Parcel::new`) or merged
/// into a transform request's invalidations (for per-asset tracking of files read by transformers).
pub struct TrackingFileSystem {
  inner: std::sync::Arc<dyn FileSystem>,
  /// Each thread's invalidations, locked only by it, except while `take` drains them.
  recorded: ThreadLocal<Mutex<Invalidations>>,
}

impl TrackingFileSystem {
  pub fn new(inner: std::sync::Arc<dyn FileSystem>) -> Self {
    TrackingFileSystem {
      inner,
      recorded: ThreadLocal::new(),
    }
  }

  fn record(&self, f: impl FnOnce(&mut Invalidations)) {
    f(&mut self.recorded.get_or_default().lock().unwrap());
  }

  fn record_read(&self, path: PathId) {
    self.record(|i| i.invalidate_on_file_change(path));
  }

  fn record_missing(&self, path: PathId) {
    self.record(|i| i.invalidate_on_file_create(path));
  }

  fn record_exists(&self, path: PathId) {
    self.record(|i| i.invalidate_on_file_delete(path));
  }

  fn record_create_above(&self, file_name: &SubPath, above: PathId) {
    self.record(|i| i.invalidate_on_file_create_above(file_name.clone(), above));
  }

  fn record_create_glob(&self, glob: String) {
    self.record(|i| i.invalidate_on_glob_create(glob));
  }

  /// Returns the invalidations recorded since the last call, without repeats.
  pub fn take(&self) -> Invalidations {
    let mut invalidations = Invalidations::default();
    for recorded in self.recorded.iter() {
      let mut recorded = std::mem::take(&mut *recorded.lock().unwrap());
      if invalidations.is_empty() {
        // Usually only one thread recorded any, e.g. while transforming one asset.
        invalidations = recorded;
      } else {
        invalidations.append(&mut recorded);
      }
    }
    for paths in [
      &mut invalidations.invalidate_on_file_change,
      &mut invalidations.invalidate_on_file_create,
      &mut invalidations.invalidate_on_file_delete,
    ] {
      paths.sort_unstable();
      paths.dedup();
    }
    invalidations
      .invalidate_on_file_create_above
      .sort_unstable();
    invalidations.invalidate_on_file_create_above.dedup();
    invalidations.invalidate_on_glob_create.sort_unstable();
    invalidations.invalidate_on_glob_create.dedup();
    invalidations
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
      // Do NOT track file change here: we only care whether the file exists, not what's
      // inside it. Deleting it, however, changes the answer (e.g. resolution falls back to
      // another candidate), so track deletion.
      self.record_exists(path);
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

  fn write(&self, path: PathId, contents: &[u8]) -> Result<()> {
    self.inner.write(path, contents)
  }

  fn write_vectored(&self, path: PathId, chunks: &[&[u8]]) -> Result<()> {
    self.inner.write_vectored(path, chunks)
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
    // matches the absolute paths checked during invalidation, and normalized so that `.` and `..`
    // segments (e.g. `./dir/*.js`) don't prevent matches.
    if is_glob(pattern) {
      let absolute = cwd.with_path(|c| normalize_path(&c.join(pattern)));
      let absolute = absolute.to_string_lossy().into_owned();
      self.record_create_glob(absolute);
    }
    // Run the actual matching against the inner file system so the directory walk isn't recorded
    // as individual file-change invalidations. Deleting a match changes the result, though.
    let matches = self.inner.glob(pattern, cwd);
    for path in &matches {
      self.record_exists(*path);
    }
    matches
  }

  fn find_ancestor(
    &self,
    from: PathId,
    file_name: &SubPath,
    kind: FileKind,
    root: Option<PathId>,
  ) -> Option<PathId> {
    let found = self.inner.find_ancestor(from, file_name, kind, root);
    if let Some(result) = found {
      // TODO: is this needed?
      self.record_read(result);
    }

    // Record a `file_create_above` invalidation: a file named `file_name` created anywhere within
    // `from` would change resolution and should trigger a rebuild. Using the found directory as
    // the boundary captures any closer file appearing between `from` and the match.
    self.record_create_above(file_name, from);

    found
  }

  fn as_object_cache(&self) -> Option<&dyn super::ObjectCache> {
    self.inner.as_object_cache()
  }
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;

  use super::*;
  use crate::{MemoryFileSystem, test_utils::path};

  fn fs() -> (Arc<dyn FileSystem>, PathId, PathId) {
    let fs = MemoryFileSystem::new();
    let file = PathId::new(&path("/project/a.js"));
    fs.create_dir_all(PathId::new(&path("/project"))).unwrap();
    fs.write(file, b"a").unwrap();
    (
      Arc::new(fs),
      file,
      PathId::new(&path("/project/missing.js")),
    )
  }

  fn record_twice(tracker: &TrackingFileSystem, file: PathId, missing: PathId) {
    let package_json = SubPath::new(std::path::Path::new("package.json"));
    let project = PathId::new(&path("/project"));
    for _ in 0..2 {
      tracker.read(file).unwrap();
      tracker.stat(file);
      tracker.kind(file);
      tracker.kind(missing);
      tracker.find_ancestor(file, &package_json, FileKind::IS_FILE, None);
      tracker.glob("*.ts", project);
    }
  }

  fn assert_recorded_once(invalidations: &Invalidations, file: PathId, missing: PathId) {
    assert_eq!(invalidations.invalidate_on_file_change, [file]);
    assert_eq!(invalidations.invalidate_on_file_create, [missing]);
    assert_eq!(invalidations.invalidate_on_file_delete, [file]);
    assert_eq!(invalidations.invalidate_on_file_create_above.len(), 1);
    assert_eq!(invalidations.invalidate_on_glob_create.len(), 1);
  }

  #[test]
  fn records_each_invalidation_once() {
    let (inner, file, missing) = fs();
    let tracker = TrackingFileSystem::new(inner);
    record_twice(&tracker, file, missing);
    assert_recorded_once(&tracker.take(), file, missing);

    // Taking empties the tracker.
    let invalidations = tracker.take();
    assert!(invalidations.invalidate_on_file_change.is_empty());
    assert!(invalidations.invalidate_on_glob_create.is_empty());
    record_twice(&tracker, file, missing);
    assert_recorded_once(&tracker.take(), file, missing);
  }

  #[test]
  fn records_each_invalidation_once_across_threads() {
    let (inner, file, missing) = fs();
    let tracker = TrackingFileSystem::new(inner);
    std::thread::scope(|scope| {
      for _ in 0..8 {
        scope.spawn(|| record_twice(&tracker, file, missing));
      }
    });
    assert_recorded_once(&tracker.take(), file, missing);
  }
}
