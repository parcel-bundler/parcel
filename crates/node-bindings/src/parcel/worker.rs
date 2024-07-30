use std::sync::mpsc::Sender;

use napi::{Env, JsObject, JsUndefined};
use napi_derive::napi;
use parcel::rpc::nodejs::NodejsWorker;
use parcel_napi_helpers::JsTransferable;

/// This function is run in the Nodejs worker context upon initialization
/// to notify the main thread that a Nodejs worker thread has started
///
/// A Rust channel is transferred to the worker via JavaScript `worker.postMessage`.
/// The worker then calls `register_worker`, supplying it with an object containing
/// callbacks.
///
/// The callbacks are later called from the main thread to send work to the worker.
///
/// |-------------| --- Init channel ----> |-------------------|
/// | Main Thread |                        | Worker Thread (n) |
/// |-------------| <-- Worker wrapper --- |-------------------|
///
///                 **Later During Build**
///
///                 -- Resolver.resolve -->
///                 <- DependencyResult ---
///
///                 -- Transf.transform -->
///                 <--- Array<Asset> -----
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
