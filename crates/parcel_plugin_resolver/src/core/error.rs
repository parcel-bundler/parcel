use std::path::PathBuf;
use std::sync::Arc;

use thiserror::Error;

use super::cache::JsonError;
use super::specifier::SpecifierError;
use super::PackageJsonError;

#[derive(Debug, Clone, PartialEq, serde::Serialize, Error)]
#[serde(tag = "type")]
pub enum ResolverError {
  #[error("Unknown scheme {scheme}")]
  UnknownScheme { scheme: String },
  #[error("Unknown error")]
  UnknownError,
  #[error("File {relative} not found from {from}")]
  FileNotFound { relative: PathBuf, from: PathBuf },
  #[error("Module {module} not found")]
  ModuleNotFound { module: String },
  #[error("Module {module} entry not found in path {entry_path} with package {package_path} and field {field}")]
  ModuleEntryNotFound {
    module: String,
    entry_path: PathBuf,
    package_path: PathBuf,
    field: &'static str,
  },
  #[error("Module {module} subpath {path} with package {package_path}")]
  ModuleSubpathNotFound {
    module: String,
    path: PathBuf,
    package_path: PathBuf,
  },
  #[error("JSON error")]
  JsonError(JsonError),
  #[error("IO error")]
  IOError(IOError),
  #[error("Package JSON error. Module {module} at path {path}")]
  PackageJsonError {
    module: String,
    path: PathBuf,
    error: PackageJsonError,
  },
  #[error("Package JSON not found from {from}")]
  PackageJsonNotFound { from: PathBuf },
  #[error("Invalid specifier")]
  InvalidSpecifier(SpecifierError),
  #[error("TS config extends not found for {tsconfig}. Error {error}")]
  TsConfigExtendsNotFound {
    tsconfig: PathBuf,
    error: Box<ResolverError>,
  },
}

#[derive(Debug, Clone)]
pub struct IOError(Arc<std::io::Error>);

impl serde::Serialize for IOError {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    #[derive(serde::Serialize)]
    struct IOErrorMessage {
      message: String,
    }

    let msg = IOErrorMessage {
      message: self.0.to_string(),
    };

    msg.serialize(serializer)
  }
}

impl PartialEq for IOError {
  fn eq(&self, other: &Self) -> bool {
    self.0.kind() == other.0.kind()
  }
}

impl From<()> for ResolverError {
  fn from(_: ()) -> Self {
    ResolverError::UnknownError
  }
}

impl From<std::str::Utf8Error> for ResolverError {
  fn from(_: std::str::Utf8Error) -> Self {
    ResolverError::UnknownError
  }
}

impl From<JsonError> for ResolverError {
  fn from(e: JsonError) -> Self {
    ResolverError::JsonError(e)
  }
}

impl From<std::io::Error> for ResolverError {
  fn from(e: std::io::Error) -> Self {
    ResolverError::IOError(IOError(Arc::new(e)))
  }
}

impl From<SpecifierError> for ResolverError {
  fn from(value: SpecifierError) -> Self {
    ResolverError::InvalidSpecifier(value)
  }
}
