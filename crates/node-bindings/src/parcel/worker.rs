use napi::{Env, JsObject, JsUndefined};
use napi_derive::napi;
use parcel::rpc::nodejs::RpcConnectionNodejs;

#[napi]
pub fn register_worker(env: Env, worker: JsObject) -> napi::Result<JsUndefined> {
  let worker = RpcConnectionNodejs::new(worker)?;
  RpcConnectionNodejs::register_worker(worker);
  env.get_undefined()
}
