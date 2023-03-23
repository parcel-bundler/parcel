use std::{
  collections::HashSet,
  path::{Path, PathBuf},
  sync::RwLock,
};

use crate::{path::normalize_path, ResolverError};

#[derive(PartialEq, Eq, Hash, Debug)]
pub enum FileCreateInvalidation {
  Path(PathBuf),
  FileName { file_name: String, above: PathBuf },
}

#[derive(Default, Debug)]
pub struct Invalidations {
  pub invalidate_on_file_create: RwLock<HashSet<FileCreateInvalidation>>,
  pub invalidate_on_file_change: RwLock<HashSet<PathBuf>>,
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

  pub fn invalidate_on_file_change(&self, invalidation: &Path) {
    self
      .invalidate_on_file_change
      .write()
      .unwrap()
      .insert(normalize_path(invalidation));
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
