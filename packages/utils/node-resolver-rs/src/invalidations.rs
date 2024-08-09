use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::RwLock;

use gxhash::HashSet;

use crate::path::normalize_path;
use crate::ResolverError;

#[derive(PartialEq, Eq, Hash, Debug, Clone)]
pub enum FileCreateInvalidation {
  Path(PathBuf),
  FileName { file_name: String, above: PathBuf },
  Glob(String),
}

#[derive(Default, Debug)]
pub struct Invalidations {
  pub invalidate_on_file_create: RwLock<HashSet<FileCreateInvalidation>>,
  pub invalidate_on_file_change: RwLock<HashSet<PathBuf>>,
  pub invalidate_on_startup: AtomicBool,
}

impl Invalidations {
  pub fn invalidate_on_file_create(&self, path: &Path) {
    self
      .invalidate_on_file_create
      .write()
      .unwrap()
      .insert(FileCreateInvalidation::Path(normalize_path(path)));
  }

  pub fn invalidate_on_file_create_above<S: Into<String>>(&self, file_name: S, above: &Path) {
    self
      .invalidate_on_file_create
      .write()
      .unwrap()
      .insert(FileCreateInvalidation::FileName {
        file_name: file_name.into(),
        above: normalize_path(above),
      });
  }

  pub fn invalidate_on_glob_create<S: Into<String>>(&self, glob: S) {
    self
      .invalidate_on_file_create
      .write()
      .unwrap()
      .insert(FileCreateInvalidation::Glob(glob.into()));
  }

  pub fn invalidate_on_file_change(&self, invalidation: &Path) {
    self
      .invalidate_on_file_change
      .write()
      .unwrap()
      .insert(normalize_path(invalidation));
  }

  pub fn invalidate_on_startup(&self) {
    self.invalidate_on_startup.store(true, Ordering::Relaxed)
  }

  pub fn extend(&self, other: &Invalidations) {
    let mut invalidate_on_file_create = self.invalidate_on_file_create.write().unwrap();
    for f in other.invalidate_on_file_create.read().unwrap().iter() {
      invalidate_on_file_create.insert(f.clone());
    }

    let mut invalidate_on_file_change = self.invalidate_on_file_change.write().unwrap();
    for f in other.invalidate_on_file_change.read().unwrap().iter() {
      invalidate_on_file_change.insert(f.clone());
    }

    if other.invalidate_on_startup.load(Ordering::Relaxed) {
      self.invalidate_on_startup();
    }
  }

  pub fn read<V, F: FnOnce() -> Result<V, ResolverError>>(
    &self,
    path: &Path,
    f: F,
  ) -> Result<V, ResolverError> {
    match f() {
      Ok(v) => {
        self.invalidate_on_file_change(path);
        Ok(v)
      }
      Err(e) => {
        if matches!(e, ResolverError::IOError(..)) {
          self.invalidate_on_file_create(path);
        }
        Err(e)
      }
    }
  }
}
