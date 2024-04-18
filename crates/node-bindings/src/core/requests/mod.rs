use std::path::Path;

use napi::bindgen_prelude::{FromNapiValue, ToNapiValue};
use napi::sys::{napi_env, napi_value};
use napi::{Env, JsFunction, JsObject, JsUnknown, NapiRaw};
use napi_derive::napi;

use crate::core::requests::request_api::js_request_api::JSRequestApi;
use crate::resolver::JsFileSystem;
use parcel_resolver::FileSystem;
use request_api::RequestApi;

mod config_request;
mod request_api;

/// Cast method field to function
///
/// # Safety
/// Uses raw NAPI casts, but checks that object field is a function
pub fn get_function(env: Env, js_object: &JsObject, field_name: &str) -> napi::Result<JsFunction> {
  let Some(method): Option<JsUnknown> = js_object.get(field_name)? else {
    return Err(napi::Error::from_reason("Method not found"));
  };
  let function_class: JsUnknown = env.get_global()?.get_named_property("Function")?;
  let is_function = method.instanceof(function_class)?;
  if !is_function {
    return Err(napi::Error::from_reason("Method is not a function"));
  }

  let method_fn = unsafe { JsFunction::from_napi_value(env.raw(), method.raw()) }?;
  Ok(method_fn)
}

pub type ProjectPath = String;

pub type InternalGlob = String;

#[napi(object)]
pub struct ConfigKeyChange {
  pub file_path: ProjectPath,
  pub config_key: String,
}

#[napi(object)]
pub struct InternalFileInvalidation {
  pub file_path: ProjectPath,
}

#[napi(object)]
pub struct InternalGlobInvalidation {
  pub glob: InternalGlob,
}

#[napi(object)]
pub struct InternalFileAboveInvalidation {
  pub file_name: String,
  pub above_file_path: ProjectPath,
}

#[napi(object)]
pub struct InternalFileCreateInvalidation {
  pub file: Option<InternalFileInvalidation>,
  pub glob: Option<InternalGlobInvalidation>,
  pub file_above: Option<InternalFileAboveInvalidation>,
}

#[napi(object)]
pub struct ConfigRequest {
  pub id: String,
  // Set<...>
  pub invalidate_on_file_change: Vec<ProjectPath>,
  pub invalidate_on_config_key_change: Vec<ConfigKeyChange>,
  pub invalidate_on_file_create: Vec<InternalFileCreateInvalidation>,
  // Set<...>
  pub invalidate_on_env_change: Vec<String>,
  // Set<...>
  pub invalidate_on_option_change: Vec<String>,
  pub invalidate_on_startup: bool,
  pub invalidate_on_build: bool,
}

fn get_config_key_content_hash(
  file_path: &str,
  config_key: &str,
  input_fs: &impl FileSystem,
  project_root: &str,
) -> napi::Result<String> {
  todo!("")
}

fn run_config_request(
  config_request: &ConfigRequest,
  api: impl RequestApi,
  input_fs: &impl FileSystem,
  project_root: &str,
) -> napi::Result<()> {
  for file_path in &config_request.invalidate_on_file_change {
    api.invalidate_on_file_update(Path::new(file_path))?;
  }

  for config_key_change in &config_request.invalidate_on_config_key_change {
    let content_hash = get_config_key_content_hash(
      &config_key_change.file_path,
      &config_key_change.config_key,
      input_fs,
      &project_root,
    )?;
    api.invalidate_on_config_key_change(
      Path::new(&config_key_change.file_path),
      &config_key_change.config_key,
      &content_hash,
    )?;
  }

  Ok(())
}

#[napi]
fn run_config_request_js(
  env: Env,
  config_request: ConfigRequest,
  api: JsObject,
  options: JsObject,
) -> napi::Result<()> {
  let api = JSRequestApi::new(env, api);
  let input_fs: JsFileSystem = todo!("");

  run_config_request(&config_request, api, &input_fs, todo!(""))
}

#[napi(object)]
struct RequestOptions {}

#[cfg(test)]
mod test {
  use super::*;

  #[test]
  fn test_execute() {
    let config_request = ConfigRequest {
      id: "".to_string(),
      invalidate_on_file_change: vec![],
      invalidate_on_config_key_change: vec![],
      invalidate_on_file_create: vec![],
      invalidate_on_env_change: vec![],
      invalidate_on_option_change: vec![],
      invalidate_on_startup: false,
      invalidate_on_build: false,
    };

    run_config_request(&config_request, todo!(""), todo!(""), todo!("")).unwrap()
  }
}
