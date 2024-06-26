use std::sync::Arc;

use crate::RpcHost;
use crate::RpcWorkerRef;

use super::RpcConnectionNodejs;
use super::RpcConnectionNodejsMulti;

// RpcHostNodejs has a connection to the main Nodejs thread and manages
// the lazy initialization of Nodejs worker threads.
pub struct RpcHostNodejs {
  node_workers: usize,
}

impl RpcHostNodejs {
  pub fn new(node_workers: usize) -> napi::Result<Self> {
    Ok(Self { node_workers })
  }
}

// Forward events to Nodejs
impl RpcHost for RpcHostNodejs {
  fn start(&self) -> anyhow::Result<RpcWorkerRef> {
    let mut connections = vec![];

    // for _ in 0..self.node_workers {
    //   connections.push(RpcConnectionNodejs::new())
    // }

    Ok(Arc::new(RpcConnectionNodejsMulti::new(connections)))
  }
}
