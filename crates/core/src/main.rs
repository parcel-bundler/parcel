use mimalloc::MiMalloc;
use parcel_core::{
  asset_graph::AssetGraphRequest, request_tracker::RequestTracker, worker_farm::WorkerFarm,
};

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

fn main() {
  let mut req = AssetGraphRequest {
    entries: vec!["/Users/devongovett/Downloads/bundler-benchmark/cases/all/src/index.js".into()],
    // entries: vec!["/Users/devongovett/dev/parcel/packages/core/integration-tests/test/integration/commonjs/index.js".into()],
  };

  let mut request_tracker = RequestTracker::new(WorkerFarm::new());
  req.build(&mut request_tracker);

  // println!("tracker {:?}", request_tracker);
}
