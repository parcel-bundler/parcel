use std::sync::Arc;

use crate::RpcHost;
use crate::RpcWorkerRef;

use super::worker_init::get_worker;
use super::RpcConnectionNodejsMulti;

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

    for _ in 0..self.node_workers {
      connections.push(get_worker())
    }

    Ok(Arc::new(RpcConnectionNodejsMulti::new(connections)))
  }
}
