use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;

use parcel::file_system::FileSystemRef;
use parcel::rpc::nodejs::RpcHostNodejs;
use parcel::rpc::RpcHostRef;
use parcel::Parcel;
use parcel_package_manager::PackageManagerRef;

use crate::file_system::FileSystemNapi;
use crate::parcel::parcel::tracing_setup::{
  setup_tracing, ParcelTracingGuard, ParcelTracingOptions,
};
use parcel_napi_helpers::anyhow_to_napi;

use super::package_manager_napi::PackageManagerNapi;

mod tracing_setup;

#[napi(object)]
pub struct ParcelNapiBuildOptions {}

#[napi(object)]
pub struct ParcelNapiBuildResult {}

#[napi(object)]
pub struct ParcelNapiOptions {
  pub fs: Option<JsObject>,
  pub node_workers: Option<u32>,
  pub options: JsObject,
  pub package_manager: Option<JsObject>,
  pub threads: Option<u32>,
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
  pub fn new(napi_options: ParcelNapiOptions, env: Env) -> napi::Result<Self> {
    // Debugging Instrumentation
    let tracing_guard = setup_tracing(&napi_options.tracing_options).map_err(anyhow_to_napi)?;

    let thread_id = std::thread::current().id();
    tracing::trace!(?thread_id, "parcel-napi initialize");

    // Wrap the JavaScript-supplied FileSystem
    let fs: Option<FileSystemRef> = if let Some(fs) = napi_options.fs {
      Some(Arc::new(FileSystemNapi::new(&fs)?))
    } else {
      None
    };

    let package_manager: Option<PackageManagerRef> = if let Some(pm) = napi_options.package_manager
    {
      Some(Arc::new(PackageManagerNapi::new(&pm)?))
    } else {
      None
    };

    // Assign Rust thread count from JavaScript
    let threads = napi_options
      .threads
      .map(|t| t as usize)
      .unwrap_or_else(|| num_cpus::get());

    // Set up Nodejs plugin bindings
    let node_worker_count = napi_options
      .node_workers
      .map(|w| w as usize)
      .unwrap_or_else(|| threads);

    let rpc_host_nodejs = RpcHostNodejs::new(node_worker_count)?;
    let rpc = Some::<RpcHostRef>(Arc::new(rpc_host_nodejs));

    Ok(Self {
      node_worker_count: node_worker_count as u32,
      parcel: Arc::new(Parcel::new(
        fs,
        env.from_js_value(napi_options.options)?,
        package_manager,
        rpc,
      )),
      tracing_guard,
    })
  }

  #[napi]
  pub fn build(&self, env: Env, _options: ParcelNapiBuildOptions) -> napi::Result<JsObject> {
    let (deferred, promise) = env.create_deferred()?;

    // Call build in its own dedicated system thread
    thread::spawn({
      let parcel = self.parcel.clone();
      move || match parcel.build() {
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
