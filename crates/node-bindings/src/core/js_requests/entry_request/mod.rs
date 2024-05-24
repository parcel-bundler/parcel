use std::rc::Rc;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;
use parcel_napi_helpers::anyhow_napi;

use super::super::requests::entry_request::run_entry_request;
use super::super::requests::entry_request::EntryRequestInput;
use super::super::requests::entry_request::EntryResult;
use super::super::requests::entry_request::RunEntryRequestParams;
use super::super::requests::request_api::js_request_api::JSRequestApi;
use crate::core::js_requests::request_options::input_fs_from_options;

/// napi entry-point for `run_entry_request`.
#[napi]
fn napi_run_entry_request(
  env: Env,
  entry_request: EntryRequestInput,
  api: JsObject,
  options: JsObject,
) -> napi::Result<EntryResult> {
  let env = Rc::new(env);
  let api = JSRequestApi::new(env.clone(), api);
  let input_fs = input_fs_from_options(env, &options)?;
  let result = run_entry_request(RunEntryRequestParams {
    run_api: &api,
    fs: &input_fs,
    input: &entry_request,
  })
  .map_err(anyhow_napi)?;

  Ok(result)
}
