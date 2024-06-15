pub mod asset_graph;
pub mod cache;
pub mod diagnostic;
pub mod environment;
mod intern;
pub mod parcel_config;
pub mod request_tracker;
pub mod requests;
pub mod transformers;
pub mod types;
pub mod worker_farm;

use asset_graph::{AssetGraph, AssetGraphRequest};
use diagnostic::Diagnostic;
use environment::reset_env_interner;
use request_tracker::{FileEvent, Request, RequestTracker};
use types::ParcelOptions;
use worker_farm::WorkerFarm;

use crate::requests::parcel_config_request::ParcelConfigRequest;

pub struct Parcel {
  request_tracker: RequestTracker,
  entries: Vec<String>,
  farm: WorkerFarm,
  options: ParcelOptions,
}

impl Parcel {
  pub fn new(entries: Vec<String>, farm: WorkerFarm, options: ParcelOptions) -> Self {
    Parcel {
      request_tracker: RequestTracker::new(),
      entries,
      farm,
      options,
    }
  }

  pub fn next_build(&mut self, events: Vec<FileEvent>) -> bool {
    self.request_tracker.next_build(events)
  }

  pub fn build_asset_graph(&mut self) -> Result<AssetGraph, Vec<Diagnostic>> {
    // TODO: this is a hack to fix the tests.
    // Environments don't include the source location in their hash,
    // and this results in interned envs being reused between tests.
    reset_env_interner();

    let config = ParcelConfigRequest {}
      .run(&self.farm, &self.options)
      .result
      .unwrap();

    let mut req = AssetGraphRequest {
      entries: &self.entries,
      transformers: &config.transformers,
      resolvers: &config.resolvers,
    };
    let asset_graph = req.build(&mut self.request_tracker, &self.farm, &self.options);

    asset_graph
  }

  pub fn read_from_cache(&mut self, key: String) {
    if let Some(buf) = self.options.cache.get(key.clone()) {
      println!("READ {:?} {:?}", key, buf.len());
      self.request_tracker = RequestTracker::from_buffer(buf);
    }
  }

  pub fn write_to_cache(&self, key: String) {
    let buf = self.request_tracker.to_buffer();
    println!("WRITE {:?} {:?}", key, buf.len());
    self.options.cache.set(key, buf);
  }
}
