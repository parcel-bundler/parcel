use std::sync::Arc;

use napi::Env;
use napi::JsFunction;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::RpcConnectionRef;
use crate::RpcHost;

use super::napi::create_js_callback;
use super::napi::send_serde;
use super::napi::RpcCallback;
use super::RpcWorkerFarmNodejs;
use super::RpcWorkerNodejs;

// RpcHostNodejs has a connection to the main Nodejs thread
pub struct RpcHostNodejs {
  tsfn: RpcCallback,
  node_workers: usize,
}

impl RpcHostNodejs {
  pub fn new(env: &Env, callback: JsFunction, node_workers: usize) -> napi::Result<Self> {
    let mut tsfn = create_js_callback(env, callback)?;

    // Normally, holding a threadsafe function tells Nodejs that an async action is
    // running and that the process should not exist until the reference is released (like an http server).
    // This tells Nodejs that it's okay to terminate the process despite active reference.
    tsfn.unref(&env)?;

    Ok(Self { node_workers, tsfn })
  }

  pub fn send<P, R>(&self, identifier: &str, params: P) -> anyhow::Result<R>
  where
    P: Serialize + Send + Sync + 'static,
    R: DeserializeOwned + Send + 'static,
  {
    send_serde(&self.tsfn, identifier, params)
  }
}

// Forward events to Nodejs
impl RpcHost for RpcHostNodejs {
  fn ping(&self) -> anyhow::Result<()> {
    self.send("ping", &())
  }

  fn start(&self) -> anyhow::Result<RpcConnectionRef> {
    let mut connections = vec![];

    for _ in 0..self.node_workers {
      connections.push(RpcWorkerNodejs::new())
    }

    Ok(Arc::new(RpcWorkerFarmNodejs::new(connections)))
  }
}
