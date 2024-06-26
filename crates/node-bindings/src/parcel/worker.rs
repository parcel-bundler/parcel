use napi::{Env, JsObject, JsUndefined};
use napi_derive::napi;
use parcel::rpc::nodejs::NodejsWorker;

#[napi]
pub fn register_worker(env: Env, worker: JsObject) -> napi::Result<JsUndefined> {
  let worker = NodejsWorker::new(worker)?;
  NodejsWorker::register_worker(worker);
  env.get_undefined()
}
