use std::sync::Arc;

use mimalloc::MiMalloc;
use parcel_core::{
  asset_graph::AssetGraphRequest,
  build,
  cache::Cache,
  parcel_config::ParcelConfig,
  request_tracker::RequestTracker,
  requests::entry_request::Entry,
  types::{Engines, Environment, EnvironmentFlags, SourceType, Target},
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
    WorkerRequest::Target(target) => Ok(WorkerResult::Target(vec![Target {
      env: Environment {
        context: parcel_core::types::EnvironmentContext::Browser,
        output_format: parcel_core::types::OutputFormat::Esmodule,
        source_type: SourceType::Module,
        source_map: None,
        flags: EnvironmentFlags::empty(),
        loc: None,
        include_node_modules: parcel_core::types::IncludeNodeModules::Bool(true),
        engines: Engines {
          browsers: Vec::new(),
          node: None,
          electron: None,
          parcel: None,
        },
      },
      dist_dir: String::new(),
      name: String::new(),
      dist_entry: None,
      public_url: String::new(),
      loc: None,
      pipeline: None,
    }])),
    _ => todo!(),
  }));

  build(
    vec!["/Users/devongovett/Downloads/bundler-benchmark/cases/all/src/index.js".into()],
    farm,
    &mut Cache::new(),
  );

  // println!("tracker {:?}", request_tracker);
}
