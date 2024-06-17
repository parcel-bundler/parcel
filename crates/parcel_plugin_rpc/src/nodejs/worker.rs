use napi::Env;
use napi::JsFunction;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::RpcWorker;

use super::napi::create_js_callback;
use super::napi::get_worker_callback;
use super::napi::register_worker_callback;
use super::napi::send_serde;
use super::napi::RpcCallback;

/// RpcWorkerNodejs wraps the communication with a single Nodejs worker thread
pub struct RpcWorkerNodejs {
  tsfn: RpcCallback,
}

impl RpcWorkerNodejs {
  pub fn new() -> Self {
    Self {
      tsfn: get_worker_callback(),
    }
  }

  pub fn create_worker_callback(env: &Env, callback: JsFunction) -> napi::Result<()> {
    register_worker_callback(create_js_callback(env, callback)?);
    Ok(())
  }

  pub fn send<P, R>(&self, identifier: &str, params: P) -> anyhow::Result<R>
  where
    P: Serialize + Send + Sync + 'static,
    R: DeserializeOwned + Send + 'static,
  {
    send_serde(&self.tsfn, identifier, params)
  }
}

impl RpcWorker for RpcWorkerNodejs {
  fn ping(&self) -> anyhow::Result<()> {
    self.send("ping", &())
  }
}
