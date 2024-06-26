use parking_lot::Mutex;

use super::RpcConnectionNodejs;

use crate::RpcWorker;

/// Connection to multiple Nodejs Workers
/// Implements round robin messaging
pub struct RpcConnectionNodejsMulti {
  current_index: Mutex<usize>, // TODO use AtomicUsize
  conns: Vec<RpcConnectionNodejs>,
}

impl RpcConnectionNodejsMulti {
  pub fn new(conns: Vec<RpcConnectionNodejs>) -> Self {
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
}

impl RpcWorker for RpcConnectionNodejsMulti {
  fn ping(&self) -> anyhow::Result<()> {
    let next = self.next_index();
    self.conns[next].ping()
  }
}
