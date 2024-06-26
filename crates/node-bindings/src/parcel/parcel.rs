use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi_derive::napi;

use parcel::rpc::nodejs::RpcHostNodejs;
use parcel::BuildOptions;
use parcel::Parcel;
use parcel::ParcelOptions;

use crate::file_system::FileSystemNapi;
use crate::parcel::parcel::tracing_setup::{
  setup_tracing, ParcelTracingGuard, ParcelTracingOptions,
};
use parcel_napi_helpers::anyhow_napi;

mod tracing_setup;

#[napi(object)]
pub struct ParcelNapiBuildOptions {}

#[napi(object)]
pub struct ParcelNapiBuildResult {}

#[napi(object)]
pub struct ParcelNapiOptions {
  pub threads: Option<u32>,
  pub node_workers: Option<u32>,
  pub fs: Option<JsObject>,
  pub rpc: JsFunction,
  pub tracing_options: Option<ParcelTracingOptions>,
}

#[napi]
pub struct ParcelNapi {
  pub node_worker_count: u32,
  tracing_guard: ParcelTracingGuard,
  parcel: Arc<Parcel>,
}

#[napi]
impl ParcelNapi {
  #[napi(constructor)]
  pub fn new(env: Env, options: ParcelNapiOptions) -> napi::Result<Self> {
    // Debugging Instrumentation
    let tracing_guard = setup_tracing(&options.tracing_options).map_err(anyhow_napi)?;

    let thread_id = std::thread::current().id();
    tracing::trace!(?thread_id, "parcel-napi initialize");

    // Parcel Core Options
    let mut parcel_options = ParcelOptions::default();

    // Wrap the JavaScript-supplied FileSystem
    if let Some(fs) = options.fs {
      parcel_options.fs = Some(Arc::new(FileSystemNapi::new(&fs)?));
    }

    // Assign Rust thread count from JavaScript
    if let Some(threads) = options.threads {
      parcel_options.threads = threads as usize;
    }

    // Set up Nodejs plugin bindings
    let node_worker_count: usize;
    if let Some(node_workers) = options.node_workers {
      node_worker_count = node_workers as usize;
    } else {
      node_worker_count = parcel_options.threads;
    }

    let rpc_host_nodejs = RpcHostNodejs::new(node_worker_count.clone())?;
    parcel_options.rpc = Some(Arc::new(rpc_host_nodejs));

    // Return self
    Ok(Self {
      node_worker_count: node_worker_count as u32,
      parcel: Arc::new(Parcel::new(parcel_options)),
      tracing_guard,
    })
  }

  #[napi]
  pub fn build(&self, env: Env, _options: ParcelNapiBuildOptions) -> napi::Result<JsObject> {
    let (deferred, promise) = env.create_deferred()?;
    // Parse build options from JS options
    let build_options = BuildOptions {};

    // Call build in its own dedicated system thread
    thread::spawn({
      let parcel = self.parcel.clone();
      move || match parcel.build(build_options) {
        Ok(_result) => deferred.resolve(|_env| Ok(ParcelNapiBuildResult {})),
        Err(error) => deferred.reject(napi::Error::from_reason(format!("{:?}", error))),
      }
    });

    Ok(promise)
  }

  // Temporary, for testing
  #[napi]
  pub async fn _testing_temp_fs_read_to_string(&self, path: String) -> napi::Result<String> {
    Ok(self.parcel.fs.read_to_string(&PathBuf::from(path))?)
  }

  #[napi]
  pub async fn _testing_temp_fs_is_file(&self, path: String) -> napi::Result<bool> {
    Ok(self.parcel.fs.is_file(&PathBuf::from(path)))
  }

  #[napi]
  pub async fn _testing_temp_fs_is_dir(&self, path: String) -> napi::Result<bool> {
    Ok(self.parcel.fs.is_dir(&PathBuf::from(path)))
  }
}
