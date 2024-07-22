use std::sync::mpsc::Sender;

use napi::{Env, JsObject, JsUndefined};
use napi_derive::napi;
use parcel::rpc::nodejs::NodejsWorker;
use parcel_napi_helpers::JsTransferable;

#[napi]
pub fn register_worker(
  env: Env,
  channel: JsTransferable<Sender<NodejsWorker>>,
  worker: JsObject,
) -> napi::Result<JsUndefined> {
  let worker = NodejsWorker::new(worker)?;
  let tx_worker = channel.take()?;
  if tx_worker.send(worker).is_err() {
    return Err(napi::Error::from_reason("Unable to register worker"));
  }
  env.get_undefined()
}
