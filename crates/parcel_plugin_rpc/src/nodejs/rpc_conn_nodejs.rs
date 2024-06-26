use napi::{JsObject, JsUnknown};
use parcel_napi_helpers::anyhow_from_napi;
use parcel_napi_helpers::js_callable::JsCallable;

use crate::RpcWorker;

use super::worker_init::register_worker;

/// RpcConnectionNodejs wraps the communication with a
/// single Nodejs worker thread
pub struct RpcConnectionNodejs {
  ping_fn: JsCallable,
}

impl RpcConnectionNodejs {
  pub fn new(delegate: JsObject) -> napi::Result<Self> {
    Ok(Self {
      ping_fn: JsCallable::new_from_object_prop_bound("ping", &delegate)?,
    })
  }

  pub fn register_worker(worker: Self) {
    register_worker(worker)
  }
}

impl RpcWorker for RpcConnectionNodejs {
  fn ping(&self) -> anyhow::Result<()> {
    self
      .ping_fn
      .call_with_return(
        |_env| Ok(Vec::<JsUnknown>::new()),
        |_env, _| Ok(Vec::<()>::new()),
      )
      .map_err(anyhow_from_napi)?;
    Ok(())
  }
}
