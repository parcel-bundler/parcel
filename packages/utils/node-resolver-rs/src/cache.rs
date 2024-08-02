use dashmap::DashMap;
use parcel_core::types::File;
use parcel_filesystem::FileSystemRef;
use std::borrow::Cow;
use std::fmt;
use std::ops::Deref;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use crate::package_json::PackageJson;
use crate::package_json::SourceField;
use crate::tsconfig::TsConfig;
use crate::tsconfig::TsConfigWrapper;
use crate::ResolverError;

pub struct Cache {
  pub fs: FileSystemRef,
  packages: DashMap<PathBuf, Arc<Result<Arc<PackageJson>, ResolverError>>>,
  tsconfigs: DashMap<PathBuf, Arc<Result<Arc<TsConfigWrapper>, ResolverError>>>,
  is_file_cache: DashMap<PathBuf, bool>,
  is_dir_cache: DashMap<PathBuf, bool>,
  realpath_cache: DashMap<PathBuf, Option<PathBuf>>,
}

impl<'a> fmt::Debug for Cache {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.debug_struct("Cache").finish()
  }
}

#[allow(clippy::large_enum_variant)]
/// Special Cow implementation for a Cache that doesn't require Clone.
pub enum CacheCow<'a> {
  Borrowed(&'a Cache),
  Owned(Cache),
}

impl<'a> Deref for CacheCow<'a> {
  type Target = Cache;

  fn deref(&self) -> &Self::Target {
    match self {
      CacheCow::Borrowed(c) => c,
      CacheCow::Owned(c) => c,
    }
  }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct JsonError {
  pub file: File,
  pub line: usize,
  pub column: usize,
  pub message: String,
}

impl JsonError {
  fn new(file: File, err: serde_json::Error) -> JsonError {
    JsonError {
      file,
      line: err.line(),
      column: err.column(),
      message: err.to_string(),
    }
  }

  fn json5(
    file: File,
    serde_json5::Error::Message { msg, location }: serde_json5::Error,
  ) -> JsonError {
    JsonError {
      file,
      line: location.as_ref().map(|l| l.line).unwrap_or(0),
      column: location.as_ref().map(|l| l.column).unwrap_or(0),
      message: msg.to_string(),
    }
  }
}

impl Cache {
  pub fn new(fs: FileSystemRef) -> Self {
    Self {
      fs,
      packages: DashMap::new(),
      tsconfigs: DashMap::new(),
      is_file_cache: DashMap::new(),
      is_dir_cache: DashMap::new(),
      realpath_cache: DashMap::new(),
    }
  }

  pub fn is_file(&self, path: &Path) -> bool {
    if let Some(is_file) = self.is_file_cache.get(path) {
      return *is_file;
    }

    let is_file = self.fs.is_file(path);
    self.is_file_cache.insert(path.to_path_buf(), is_file);
    is_file
  }

  pub fn is_dir(&self, path: &Path) -> bool {
    if let Some(is_file) = self.is_dir_cache.get(path) {
      return *is_file;
    }

    let is_file = self.fs.is_dir(path);
    self.is_dir_cache.insert(path.to_path_buf(), is_file);
    is_file
  }

  pub fn canonicalize(&self, path: &Path) -> Result<PathBuf, ResolverError> {
    Ok(self.fs.canonicalize(path, &self.realpath_cache)?)
  }

  pub fn read_package(&self, path: Cow<Path>) -> Arc<Result<Arc<PackageJson>, ResolverError>> {
    if let Some(pkg) = self.packages.get(path.as_ref()) {
      return pkg.clone();
    }

    fn read_package<'a>(
      fs: &'a FileSystemRef,
      realpath_cache: &'a DashMap<PathBuf, Option<PathBuf>>,
      path: &Path,
    ) -> Result<PackageJson, ResolverError> {
      let contents: String = fs.read_to_string(&path)?;
      let mut pkg = PackageJson::parse(PathBuf::from(path), &contents).map_err(|e| {
        JsonError::new(
          File {
            path: PathBuf::from(path),
            contents: contents.into(),
          },
          e,
        )
      })?;

      // If the package has a `source` field, make sure
      // - the package is behind symlinks
      // - and the realpath to the packages does not includes `node_modules`.
      // Since such package is likely a pre-compiled module
      // installed with package managers, rather than including a source code.
      if !matches!(pkg.source, SourceField::None) {
        let realpath = fs.canonicalize(&pkg.path, realpath_cache)?;
        if realpath == pkg.path
          || realpath
            .components()
            .any(|c| c.as_os_str() == "node_modules")
        {
          pkg.source = SourceField::None;
        }
      }

      Ok(pkg)
    }

    let path = path.into_owned();
    let package: Result<PackageJson, ResolverError> =
      read_package(&self.fs, &self.realpath_cache, &path);

    // Since we have exclusive access to packages,
    let entry = Arc::new(package.map(|pkg| Arc::new(pkg)));
    let _ = self.packages.insert(path.clone(), entry.clone());
    entry
  }

  pub fn read_tsconfig<F: FnOnce(&mut TsConfigWrapper) -> Result<(), ResolverError>>(
    &self,
    path: &Path,
    process: F,
  ) -> Arc<Result<Arc<TsConfigWrapper>, ResolverError>> {
    if let Some(tsconfig) = self.tsconfigs.get(path) {
      return tsconfig.clone();
    }

    fn read_tsconfig<'a, F: FnOnce(&mut TsConfigWrapper) -> Result<(), ResolverError>>(
      fs: &FileSystemRef,
      path: &Path,
      process: F,
    ) -> Result<TsConfigWrapper, ResolverError> {
      let data = fs.read_to_string(path)?;
      let mut tsconfig = TsConfig::parse(path.to_owned(), &data).map_err(|e| {
        JsonError::json5(
          File {
            contents: data,
            path: path.to_owned(),
          },
          e,
        )
      })?;
      process(&mut tsconfig)?;
      Ok(tsconfig)
    }

    let entry = read_tsconfig(&self.fs, path, process).map(|t| Arc::new(t));
    let tsconfig = Arc::new(entry);
    let _ = self.tsconfigs.insert(PathBuf::from(path), tsconfig.clone());

    tsconfig
  }
}
