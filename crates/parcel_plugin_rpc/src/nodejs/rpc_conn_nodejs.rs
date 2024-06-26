use napi::JsObject;
// use parcel_napi_helpers::js_callable::JsCallable;

use crate::RpcWorker;

/// RpcConnectionNodejs wraps the communication with a
/// single Nodejs worker thread
pub struct RpcConnectionNodejs {
  // ping_fn: JsCallable
}

impl RpcConnectionNodejs {
  pub fn new(delegate: JsObject) -> napi::Result<Self> {
    Ok(Self {
      // ping_fn: JsCallable::new_from_object_prop_bound("ping", &delegate)?,
    })
  }
}

impl RpcWorker for RpcConnectionNodejs {
  fn ping(&self) -> anyhow::Result<()> {
    Ok(())
  }
}
