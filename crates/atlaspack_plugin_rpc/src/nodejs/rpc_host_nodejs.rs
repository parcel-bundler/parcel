use std::sync::mpsc::Receiver;
use std::sync::Arc;

use anyhow::anyhow;
use parking_lot::Mutex;

use crate::RpcHost;
use crate::RpcWorkerRef;

use super::NodejsWorker;
use super::NodejsWorkerFarm;

pub struct RpcHostNodejs {
  node_workers: usize,
  rx_worker: Mutex<Receiver<NodejsWorker>>,
}

impl RpcHostNodejs {
  pub fn new(node_workers: usize, rx_worker: Receiver<NodejsWorker>) -> napi::Result<Self> {
    Ok(Self {
      node_workers,
      rx_worker: Mutex::new(rx_worker),
    })
  }
}

// Forward events to Nodejs
impl RpcHost for RpcHostNodejs {
  fn start(&self) -> anyhow::Result<RpcWorkerRef> {
    let rx_worker = self.rx_worker.lock();
    let mut connections = vec![];

    for _ in 0..self.node_workers {
      let Ok(worker) = rx_worker.recv() else {
        return Err(anyhow!("Unable to receive NodejsWorker"));
      };
      connections.push(worker)
    }

    Ok(Arc::new(NodejsWorkerFarm::new(connections)))
  }
}
