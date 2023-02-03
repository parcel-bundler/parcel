use std::{
  collections::HashSet,
  path::{Component, Path, PathBuf},
  sync::RwLock,
};

use crate::ResolverError;

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

fn normalize_path(path: &Path) -> PathBuf {
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
