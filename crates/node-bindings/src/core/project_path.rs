use std::path::Path;
use std::path::PathBuf;
use std::path::StripPrefixError;

use napi::bindgen_prelude::FromNapiValue;
use napi::bindgen_prelude::ToNapiValue;
use napi::sys::napi_env;
use napi::sys::napi_value;

/// Similar to opaque type ProjectPath in Rust.
///
/// The main purpose of this newtype is to allow us to return PathBuf from rust and have
/// napi auto convert it to string - for now.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectPath {
  path: PathBuf,
}

impl ProjectPath {
  pub fn new(project_root: &Path, path: &Path) -> Result<Self, StripPrefixError> {
    let path = path.strip_prefix(project_root)?.to_path_buf();
    Ok(Self { path })
  }
}

impl From<&str> for ProjectPath {
  fn from(path: &str) -> Self {
    Self {
      path: PathBuf::from(path),
    }
  }
}

impl From<PathBuf> for ProjectPath {
  fn from(path: PathBuf) -> Self {
    Self { path }
  }
}

impl AsRef<Path> for ProjectPath {
  fn as_ref(&self) -> &Path {
    &self.path
  }
}

impl ToNapiValue for ProjectPath {
  unsafe fn to_napi_value(env: napi_env, val: Self) -> napi::Result<napi_value> {
    let path_str = val
      .path
      .to_str()
      .ok_or_else(|| napi::Error::from_reason("Invalid path can't be converted into JS string"))?;

    ToNapiValue::to_napi_value(env, path_str)
  }
}

impl FromNapiValue for ProjectPath {
  unsafe fn from_napi_value(env: napi_env, napi_val: napi_value) -> napi::Result<Self> {
    let path_str: &str = FromNapiValue::from_napi_value(env, napi_val)?;
    Ok(ProjectPath::from(PathBuf::from(path_str)))
  }
}
