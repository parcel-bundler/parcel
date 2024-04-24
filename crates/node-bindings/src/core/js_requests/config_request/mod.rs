use std::rc::Rc;

use napi::{Env, JsObject, JsString};
use napi_derive::napi;

use crate::core::filesystem::js_delegate_file_system::JSDelegateFileSystem;
use crate::core::requests::config_request::{run_config_request, ConfigRequest};
use crate::core::requests::request_api::js_request_api::JSRequestApi;

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
  let api = JSRequestApi::new(env.clone(), api);
  let input_fs = options.get("inputFS")?;
  let Some(input_fs) = input_fs.map(|input_fs| JSDelegateFileSystem::new(env, input_fs)) else {
    // We need to make the `FileSystem` trait object-safe so we can use dynamic
    // dispatch.
    return Err(napi::Error::from_reason(
      "[napi] Missing required inputFS options field",
    ));
  };
  let Some(project_root): Option<JsString> = options.get("projectRoot")? else {
    return Err(napi::Error::from_reason(
      "[napi] Missing required projectRoot options field",
    ));
  };
  // TODO: what if the string is UTF16 or latin?
  let project_root = project_root.into_utf8()?;
  let project_root = project_root.as_str()?;

  run_config_request(&config_request, &api, &input_fs, project_root)
}
