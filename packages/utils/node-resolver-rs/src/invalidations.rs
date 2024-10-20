use std::{
  cell::{Cell, RefCell},
  collections::HashSet,
  hash::BuildHasherDefault,
  sync::Arc,
};

use rustc_hash::FxHasher;

use crate::{
  cache::{CachedPath, IdentityHasher},
  ResolverError,
};

#[derive(PartialEq, Eq, Hash, Debug, Clone)]
pub enum FileCreateInvalidation {
  Path(CachedPath),
  FileName {
    file_name: String,
    above: CachedPath,
  },
  Glob(String),
}

#[derive(Default, Debug)]
pub struct Invalidations {
  pub invalidate_on_file_create:
    RefCell<HashSet<FileCreateInvalidation, BuildHasherDefault<FxHasher>>>,
  pub invalidate_on_file_change: RefCell<HashSet<CachedPath, BuildHasherDefault<IdentityHasher>>>,
  pub invalidate_on_startup: Cell<bool>,
}

impl Invalidations {
  pub fn invalidate_on_file_create(&self, path: CachedPath) {
    self
      .invalidate_on_file_create
      .borrow_mut()
      .insert(FileCreateInvalidation::Path(path));
  }

  pub fn invalidate_on_file_create_above<S: Into<String>>(&self, file_name: S, above: CachedPath) {
    self
      .invalidate_on_file_create
      .borrow_mut()
      .insert(FileCreateInvalidation::FileName {
        file_name: file_name.into(),
        above,
      });
  }

  pub fn invalidate_on_glob_create<S: Into<String>>(&self, glob: S) {
    self
      .invalidate_on_file_create
      .borrow_mut()
      .insert(FileCreateInvalidation::Glob(glob.into()));
  }

  pub fn invalidate_on_file_change(&self, invalidation: CachedPath) {
    self
      .invalidate_on_file_change
      .borrow_mut()
      .insert(invalidation);
  }

  pub fn invalidate_on_startup(&self) {
    self.invalidate_on_startup.set(true)
  }

  pub fn extend(&self, other: &Invalidations) {
    for f in other.invalidate_on_file_create.borrow().iter() {
      self
        .invalidate_on_file_create
        .borrow_mut()
        .insert(f.clone());
    }

    for f in other.invalidate_on_file_change.borrow().iter() {
      self
        .invalidate_on_file_change
        .borrow_mut()
        .insert(f.clone());
    }

    if other.invalidate_on_startup.get() {
      self.invalidate_on_startup();
    }
  }

  pub fn read<V, F: FnOnce() -> Arc<Result<V, ResolverError>>>(
    &self,
    path: &CachedPath,
    f: F,
  ) -> Arc<Result<V, ResolverError>> {
    let res = f();
    match &*res {
      Ok(_) => {
        self.invalidate_on_file_change(path.clone());
      }
      Err(e) => {
        if matches!(e, ResolverError::IOError(..)) {
          self.invalidate_on_file_create(path.clone());
        }
      }
    }
    res
  }
}
