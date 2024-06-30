use std::sync::Arc;

use crate::{
  parcel_config::ParcelConfig,
  request_tracker::Invalidation,
  requests::{
    asset_request::TransformerResult,
    bundle_graph_request::BundleGraphRequest,
    entry_request::{Entry, EntryRequest},
  },
  transformers::plugin_transformer::PluginTransformRequest,
  types::{Bundle, Target},
};

pub type WorkerCallback =
  Arc<dyn Fn(WorkerRequest) -> Result<WorkerResult, WorkerError> + Send + Sync>;

pub struct WorkerFarm {
  workers: Vec<WorkerCallback>,
}

#[derive(serde::Serialize, Debug)]
#[serde(tag = "type")]
pub enum WorkerRequest {
  ParcelConfig,
  Entry(EntryRequest),
  Target(Entry),
  Transform(PluginTransformRequest),
  BundleGraph(BundleGraphRequest),
}

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type", content = "value")]
pub enum WorkerResult {
  ParcelConfig(ParcelConfig),
  Entry {
    entries: Vec<Entry>,
    invalidations: Vec<Invalidation>,
  },
  Target {
    targets: Vec<Target>,
    invalidations: Vec<Invalidation>,
  },
  Transform(TransformerResult),
  BundleGraph(Vec<Bundle>),
}

#[derive(serde::Deserialize, Debug)]
pub enum WorkerError {}

impl WorkerFarm {
  pub fn new() -> Self {
    Self {
      workers: Vec::new(),
    }
  }

  pub fn register_worker(&mut self, worker: WorkerCallback) {
    self.workers.push(worker);
  }

  pub fn run(&self, request: WorkerRequest) -> Result<WorkerResult, WorkerError> {
    // TODO: actually use multiple workers
    let worker = &self.workers[0];
    worker(request)
  }
}

impl std::fmt::Debug for WorkerFarm {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str("WorkerFarm {}")?;
    Ok(())
  }
}
