use std::rc::Rc;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;

use parcel_core::requests::config_request::run_config_request;
use parcel_core::requests::config_request::ConfigRequest;
use parcel_core::requests::request_api::js_request_api::JSRequestApi;

use crate::core::js_requests::request_options::input_fs_from_options;
use crate::core::js_requests::request_options::project_root_from_options;

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
  let input_fs = input_fs_from_options(env, &options)?;
  let project_root = project_root_from_options(&options)?;

  run_config_request(&config_request, &api, &input_fs, &project_root)
}
