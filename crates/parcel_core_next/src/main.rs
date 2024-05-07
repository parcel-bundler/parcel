use std::sync::Arc;

use mimalloc::MiMalloc;
use parcel_core_next::build;
use parcel_core_next::cache::Cache;
use parcel_core_next::environment::Browsers;
use parcel_core_next::environment::Engines;
use parcel_core_next::environment::Environment;
use parcel_core_next::environment::EnvironmentContext;
use parcel_core_next::environment::EnvironmentFlags;
use parcel_core_next::environment::OutputFormat;
use parcel_core_next::environment::SourceType;
use parcel_core_next::parcel_config::ParcelConfig;
use parcel_core_next::request_tracker::requests::entry_request::Entry;
use parcel_core_next::types::Target;
use parcel_core_next::worker_farm::WorkerFarm;
use parcel_core_next::worker_farm::WorkerRequest;
use parcel_core_next::worker_farm::WorkerResult;

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
    WorkerRequest::Target(_target) => Ok(WorkerResult::Target(vec![Target {
      env: Environment {
        context: EnvironmentContext::Browser,
        output_format: OutputFormat::Esmodule,
        source_type: SourceType::Module,
        source_map: None,
        flags: EnvironmentFlags::empty(),
        loc: None,
        include_node_modules: parcel_resolver::IncludeNodeModules::Bool(true),
        engines: Engines {
          browsers: Browsers::default(),
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
