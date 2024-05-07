use std::sync::Arc;

use crate::parcel_config::ParcelConfig;
use crate::plugins::transformer_dyn_napi::PluginTransformRequest;
use crate::request_tracker::requests::asset_request::AssetRequestResult;
use crate::request_tracker::requests::bundle_graph_request::BundleGraphRequest;
use crate::request_tracker::requests::entry_request::Entry;
use crate::request_tracker::requests::entry_request::EntryRequest;
use crate::request_tracker::requests::target_request::TargetRequest;
use crate::types::Bundle;
use crate::types::Target;

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
  Target(TargetRequest),
  Transform(PluginTransformRequest),
  BundleGraph(BundleGraphRequest),
}

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type", content = "value")]
pub enum WorkerResult {
  ParcelConfig(ParcelConfig),
  Entry(Vec<Entry>),
  Target(Vec<Target>),
  Transform(AssetRequestResult),
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
