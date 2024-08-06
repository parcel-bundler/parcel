use std::path::PathBuf;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;

use super::NodejsWorker;

use crate::RpcWorker;

/// Connection to multiple Nodejs Workers
/// Implements round robin messaging
pub struct NodejsWorkerFarm {
  current_index: AtomicUsize,
  conns: Vec<NodejsWorker>,
}

impl NodejsWorkerFarm {
  pub fn new(conns: Vec<NodejsWorker>) -> Self {
    Self {
      current_index: Default::default(),
      conns,
    }
  }

  #[allow(unused)]
  fn next_index(&self) -> usize {
    self
      .current_index
      .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
        Some((value + 1) % self.conns.len())
      })
      .expect("Unable to pick next worker")
  }
}

impl RpcWorker for NodejsWorkerFarm {
  fn ping(&self) -> anyhow::Result<()> {
    for conn in &self.conns {
      conn.ping()?;
    }
    Ok(())
  }

  fn load_resolver(&self, root_dir: PathBuf, specifier: String) -> anyhow::Result<String> {
    // Send to all workers

    let mut id = None::<String>;

    for conn in &self.conns {
      id.replace(conn.load_resolver(root_dir.clone(), specifier.clone())?);
    }

    let Some(id) = id else {
      return Err(anyhow::anyhow!("No identifier set"));
    };

    Ok(id)
  }
}
