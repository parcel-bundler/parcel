use napi::{Env, JsFunction, JsUndefined};
use napi_derive::napi;

use parcel::rpc::nodejs::RpcConnectionNodejs;

#[napi]
pub fn worker_callback(env: Env, callback: JsFunction) -> napi::Result<JsUndefined> {
  RpcConnectionNodejs::create_worker_callback(&env, callback)?;
  env.get_undefined()
}
