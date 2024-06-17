use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use napi::Env;
use napi::JsObject;
use napi::JsUnknown;
use napi_derive::napi;
use parcel::rpc::nodejs::RpcHostNodejs;
use parcel::BuildOptions;
use parcel::Parcel;
use parcel::ParcelOptions;

use crate::file_system::FileSystemNapi;

#[napi]
pub struct ParcelNapi {
  pub node_worker_count: u32,
  parcel: Arc<Parcel>,
}

#[napi]
impl ParcelNapi {
  #[napi(constructor)]
  pub fn new(env: Env, options: JsObject) -> napi::Result<Self> {
    // Debugging Instrumentation
    let _ = tracing_subscriber::fmt::try_init();
    let thread_id = std::thread::current().id();
    tracing::trace!(?thread_id, "parcel-napi initialize");

    // Parcel Core Options
    let mut parcel_options = ParcelOptions::default();

    // Wrap the JavaScript-supplied FileSystem
    parcel_options.fs = FileSystemNapi::from_options(&env, &options)?;

    // Assign Rust thread count from JavaScript
    let js_threads = options.get_named_property::<JsUnknown>("threads")?;
    parcel_options.threads = match js_threads.get_type()? {
      napi::ValueType::Undefined => Ok(parcel_options.threads),
      napi::ValueType::Number => Ok(js_threads.coerce_to_number()?.get_uint32()? as usize),
      _ => Err(napi::Error::from_reason("Expected number for threads")),
    }?;

    // Set up Nodejs plugin bindings
    let js_node_workers = options.get_named_property::<JsUnknown>("nodeWorkers")?;
    let node_worker_count = match js_node_workers.get_type()? {
      napi::ValueType::Undefined => Ok(parcel_options.threads.clone()),
      napi::ValueType::Number => Ok(js_node_workers.coerce_to_number()?.get_uint32()? as usize),
      _ => Err(napi::Error::from_reason("Expected number for threads")),
    }?;

    let rpc_host_nodejs = RpcHostNodejs::new(
      &env,
      options.get_named_property("rpc")?,
      node_worker_count.clone(),
    )?;
    parcel_options.rpc = Some(Arc::new(rpc_host_nodejs));

    // Return self
    Ok(Self {
      node_worker_count: node_worker_count as u32,
      parcel: Arc::new(Parcel::new(parcel_options)),
    })
  }

  #[napi]
  pub fn build(&self, env: Env, _options: JsObject) -> napi::Result<JsObject> {
    let (deferred, promise) = env.create_deferred()?;
    // Parse build options from JS options
    let build_options = BuildOptions {};

    // Call build in its own dedicated system thread
    thread::spawn({
      let parcel = self.parcel.clone();
      move || match parcel.build(build_options) {
        Ok(_result) => deferred.resolve(|env| env.create_object()),
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

  #[napi]
  pub async fn _testing_rpc_ping(&self) -> napi::Result<()> {
    if self.parcel.rpc.as_ref().unwrap().ping().is_err() {
      return Err(napi::Error::from_reason("Failed to run"));
    }
    Ok(())
  }
}
