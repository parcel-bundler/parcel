use std::sync::Arc;

use mimalloc::MiMalloc;
use parcel_core::{
  asset_graph::AssetGraphRequest,
  parcel_config::ParcelConfig,
  request_tracker::RequestTracker,
  requests::entry_request::Entry,
  worker_farm::{WorkerFarm, WorkerRequest, WorkerResult},
};

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

fn main() {
  let mut req = AssetGraphRequest {
    entries: vec!["/Users/devongovett/Downloads/bundler-benchmark/cases/all/src/index.js".into()],
    // entries: vec!["/Users/devongovett/dev/parcel/packages/core/integration-tests/test/integration/commonjs/index.js".into()],
  };

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

  let mut request_tracker = RequestTracker::new(farm);
  req.build(&mut request_tracker);

  // println!("tracker {:?}", request_tracker);
}
