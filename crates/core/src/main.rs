use std::sync::Arc;

use mimalloc::MiMalloc;
use parcel_core::{
  asset_graph::AssetGraphRequest,
  build,
  cache::Cache,
  parcel_config::ParcelConfig,
  request_tracker::RequestTracker,
  requests::entry_request::Entry,
  worker_farm::{WorkerFarm, WorkerRequest, WorkerResult},
};

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

fn main() {
  let mut farm = WorkerFarm::new();
  farm.register_worker(Arc::new(|req| match req {
    WorkerRequest::Entry(entry) => Ok(WorkerResult::Entry(vec![Entry {
      file_path: entry.entry.clone(),
      package_path: "/".into(),
      target: None,
    }])),
    WorkerRequest::ParcelConfig => Ok(WorkerResult::ParcelConfig(ParcelConfig::default())),
    _ => todo!(),
  }));

  build(
    vec!["/Users/devongovett/Downloads/bundler-benchmark/cases/all/src/index.js".into()],
    farm,
    &mut Cache::new(),
  );

  // println!("tracker {:?}", request_tracker);
}
