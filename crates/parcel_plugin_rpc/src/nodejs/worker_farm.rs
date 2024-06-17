use parking_lot::Mutex;
use serde::{de::DeserializeOwned, Serialize};

use super::RpcWorkerNodejs;

use crate::RpcWorker;

/// RpcWorkerFarmNodejs is a wrapper around multiple workers
/// forwarding messages to each worker as needed
pub struct RpcWorkerFarmNodejs {
  current_index: Mutex<usize>,
  conns: Vec<RpcWorkerNodejs>,
}

impl RpcWorkerFarmNodejs {
  pub fn new(conns: Vec<RpcWorkerNodejs>) -> Self {
    Self {
      current_index: Default::default(),
      conns,
    }
  }

  fn next_index(&self) -> usize {
    let mut current_index = self.current_index.lock();
    if *current_index >= self.conns.len() - 1 {
      *current_index = 0;
    } else {
      *current_index = *current_index + 1;
    }
    current_index.clone()
  }

  pub fn send<P, R>(&self, identifier: &str, params: P) -> anyhow::Result<R>
  where
    P: Serialize + Send + Sync + 'static,
    R: DeserializeOwned + Send + 'static,
  {
    let next = self.next_index();
    self.conns[next].send(identifier, params)
  }
}

impl RpcWorker for RpcWorkerFarmNodejs {
  fn ping(&self) -> anyhow::Result<()> {
    let next = self.next_index();
    self.conns[next].ping()
  }
}
