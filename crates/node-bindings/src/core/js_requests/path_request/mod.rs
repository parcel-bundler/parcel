use crate::core::requests::path_request::{run_path_request, PathRequestInput};
use napi::{JsObject, JsUnknown};
use napi_derive::napi;

#[napi]
fn napi_run_path_request(input: PathRequestInput) {
  run_path_request(input)
}
