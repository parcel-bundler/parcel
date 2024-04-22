use std::rc::Rc;

use napi::bindgen_prelude::FromNapiValue;
use napi::{Env, JsFunction, JsObject, JsString, JsUnknown, NapiRaw};
use napi_derive::napi;

use parcel_resolver::OsFileSystem;

use crate::core::requests::config_request::ConfigRequest;
use crate::core::requests::request_api::js_request_api::JSRequestApi;

mod config_request;
mod request_api;

/// Get an object field as a JSFunction. Will error out if the field is not present or isn't an
/// instance of the global `"Function"`.
///
/// ## Safety
/// Uses raw NAPI casts, but checks that object field is a function
pub fn get_function(env: &Env, js_object: &JsObject, field_name: &str) -> napi::Result<JsFunction> {
  let Some(method): Option<JsUnknown> = js_object.get(field_name)? else {
    return Err(napi::Error::from_reason("[napi] Method not found"));
  };
  let function_class: JsUnknown = env.get_global()?.get_named_property("Function")?;
  let is_function = method.instanceof(function_class)?;
  if !is_function {
    return Err(napi::Error::from_reason("[napi] Method is not a function"));
  }

  let method_fn = unsafe { JsFunction::from_napi_value(env.raw(), method.raw()) }?;
  Ok(method_fn)
}

/// Call a method on an object with a set of arguments.
///
/// Will error out if the method doesn't exist or if the field is not a function.
///
/// This does some redundant work ; so you may want to call `get_function`
/// directly if calling a method on a loop.
///
/// The function takes `JsUnknown` references so any type can be used as an
/// argument.
///
/// ## Safety
/// Uses raw NAPI casts, but checks that object field is a function
///
/// ## Example
/// ```skip
/// let string_parameter = env.create_string(path.to_str().unwrap())?;
/// let args = [&string_parameter.into_unknown()];
/// let field_name = "method";
///
/// call_method(&self.env, &js_object, field_name, &args)?;
/// ```
pub fn call_method(
  env: &Env,
  js_object: &JsObject,
  field_name: &str,
  args: &[&JsUnknown],
) -> napi::Result<()> {
  let method_fn = get_function(env, js_object, field_name)?;
  method_fn.call(Some(&js_object), &args)?;
  Ok(())
}

/// JavaScript API for running a config request.
/// At the moment the request fields themselves will be copied on call.
///
/// This is not efficient but can be worked around when it becomes an issue.
///
/// This should have exhaustive unit-tests on `packages/core/core/test/requests/ConfigRequest.test.js`.
#[napi]
fn napi_run_config_request(
  env: Env,
  config_request: ConfigRequest,
  api: JsObject,
  options: JsObject,
) -> napi::Result<()> {
  // Technically we could move `env` to JSRequestAPI but in order to
  // be able to use env on more places we rc it.
  let env = Rc::new(env);
  let api = JSRequestApi::new(env, api);
  let input_fs = OsFileSystem::default();
  let Some(project_root): Option<JsString> = options.get("projectRoot")? else {
    return Err(napi::Error::from_reason(
      "[napi] Missing required projectRoot options field",
    ));
  };
  // TODO: what if the string is UTF16 or latin?
  let project_root = project_root.into_utf8()?;
  let project_root = project_root.as_str()?;

  config_request::run_config_request(&config_request, &api, &input_fs, project_root)
}
