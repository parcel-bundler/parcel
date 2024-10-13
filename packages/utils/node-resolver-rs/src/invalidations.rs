use std::{
  collections::{HashMap, HashSet},
  hash::BuildHasherDefault,
  path::{Path, PathBuf},
  sync::atomic::{AtomicBool, Ordering},
};

use gxhash::GxHasher;
use parking_lot::RwLock;

use crate::{
  path::{normalize_path, IdentityHasher, InternedPath},
  ResolverError,
};

#[derive(PartialEq, Eq, Hash, Debug, Clone)]
pub enum FileCreateInvalidation {
  Path(InternedPath),
  FileName {
    file_name: String,
    above: InternedPath,
  },
  Glob(String),
}

#[derive(Default, Debug)]
pub struct Invalidations {
  pub invalidate_on_file_create:
    RwLock<HashSet<FileCreateInvalidation, BuildHasherDefault<GxHasher>>>,
  pub invalidate_on_file_change: RwLock<HashSet<InternedPath, BuildHasherDefault<IdentityHasher>>>,
  pub invalidate_on_startup: AtomicBool,
}

impl Invalidations {
  pub fn invalidate_on_file_create(&self, path: InternedPath) {
    self
      .invalidate_on_file_create
      .write()
      .insert(FileCreateInvalidation::Path(path));
  }

  pub fn invalidate_on_file_create_above<S: Into<String>>(
    &self,
    file_name: S,
    above: InternedPath,
  ) {
    self
      .invalidate_on_file_create
      .write()
      .insert(FileCreateInvalidation::FileName {
        file_name: file_name.into(),
        above,
      });
  }

  pub fn invalidate_on_glob_create<S: Into<String>>(&self, glob: S) {
    self
      .invalidate_on_file_create
      .write()
      .insert(FileCreateInvalidation::Glob(glob.into()));
  }

  pub fn invalidate_on_file_change(&self, invalidation: InternedPath) {
    self.invalidate_on_file_change.write().insert(invalidation);
  }

  pub fn invalidate_on_startup(&self) {
    self.invalidate_on_startup.store(true, Ordering::Relaxed)
  }

  pub fn extend(&self, other: &Invalidations) {
    for f in other.invalidate_on_file_create.read().iter() {
      self.invalidate_on_file_create.write().insert(f.clone());
    }

    for f in other.invalidate_on_file_change.read().iter() {
      self.invalidate_on_file_change.write().insert(f.clone());
    }

    if other.invalidate_on_startup.load(Ordering::Relaxed) {
      self.invalidate_on_startup();
    }
  }

  pub fn read<V, F: FnOnce() -> Result<V, ResolverError>>(
    &self,
    path: &InternedPath,
    f: F,
  ) -> Result<V, ResolverError> {
    match f() {
      Ok(v) => {
        self.invalidate_on_file_change(path.clone());
        Ok(v)
      }
      Err(e) => {
        if matches!(e, ResolverError::IOError(..)) {
          self.invalidate_on_file_create(path.clone());
        }
        Err(e)
      }
    }
  }
}
