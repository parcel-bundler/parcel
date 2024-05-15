//! Provides helpers to cast from a `JsObject` options object into a few common
//! options
//!
//! This corresponds to the `RequestOptions` javascript type.
//!
//! The options read are `options.inputFS` and `options.projectRoot`.
//!
//! This is either a no-copy (for inputFS) or a copy on read operation
//! (for projectRoot).
use std::path::PathBuf;
use std::rc::Rc;

use napi::Env;
use napi::JsObject;
use napi::JsString;
use napi_derive::napi;
use parcel_filesystem::js_delegate_file_system::JSDelegateFileSystem;
use parcel_package_manager::js_package_manager::JsPackageManager;

pub fn project_root_from_options(options: &JsObject) -> napi::Result<PathBuf> {
  let Some(project_root): Option<JsString> = options.get("projectRoot")? else {
    return Err(napi::Error::from_reason(
      "[napi] Missing required projectRoot options field",
    ));
  };
  let project_root = project_root.into_utf8()?;
  let project_root = project_root.as_str()?;
  Ok(PathBuf::from(project_root))
}

#[napi(object)]
pub struct AdditionalReporter {
  pub package_name: String,
  pub resolve_from: String,
}

pub fn additional_reporters_from_options(
  options: &JsObject,
) -> napi::Result<Vec<AdditionalReporter>> {
  let additional_reporters = options.get("additionalReporters")?.unwrap_or(Vec::new());

  Ok(additional_reporters)
}

pub fn input_fs_from_options(
  env: Rc<Env>,
  options: &JsObject,
) -> napi::Result<JSDelegateFileSystem> {
  let Some(input_fs) = options
    .get("inputFS")?
    .map(|input_fs| JSDelegateFileSystem::new(env, input_fs))
  else {
    // We need to make the `FileSystem` trait object-safe, so we can use dynamic
    // dispatch.
    return Err(napi::Error::from_reason(
      "[napi] Missing required inputFS options field",
    ));
  };
  Ok(input_fs)
}

pub fn package_manager_from_options(
  env: Rc<Env>,
  options: &JsObject,
) -> napi::Result<JsPackageManager> {
  let package_manager = options.get("packageManager")?;

  match package_manager {
    None => Err(napi::Error::from_reason(
      "[napi] Missing required packageManager options field",
    )),
    Some(package_manager) => Ok(JsPackageManager::new(env, package_manager)),
  }
}
