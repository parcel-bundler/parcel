use std::sync::Arc;

use mimalloc::MiMalloc;
use parcel_core::{
  build,
  cache::Cache,
  environment::{
    Browsers, Engines, Environment, EnvironmentContext, EnvironmentFlags, OutputFormat, SourceType,
  },
  parcel_config::ParcelConfig,
  requests::entry_request::Entry,
  types::{ParcelOptions, Target},
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
    ParcelOptions {
      mode: parcel_core::types::BuildMode::Development,
      env: Default::default(),
      log_level: parcel_core::types::LogLevel::Info,
      project_root: "/".into(),
    },
  );

  // println!("tracker {:?}", request_tracker);
}
