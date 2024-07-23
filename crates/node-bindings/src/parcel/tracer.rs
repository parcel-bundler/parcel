use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use napi::bindgen_prelude::FromNapiValue;
use napi::bindgen_prelude::ToNapiValue;
use napi::JsNumber;
use napi::JsObject;
use napi::JsString;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tracing_appender::non_blocking::WorkerGuard;

/// Ensures there is only ever one tracer running, initialized the first time it is needed.
/// When it's dropped certain resources related to tracing might flush to disk or be released.
/// It should be kept alive for the duration of the program or the Parcel instance.
static GLOBAL_TRACER: Lazy<Mutex<Option<Tracer>>> = Lazy::new(|| Default::default());

#[derive(Debug)]
pub enum TracerMode {
  /// Disable the Tracer
  Disabled,
  /// Output the Tracer logs to Stdout
  Stdout,
  /// Output the Tracer logs to a file
  File {
    /// The directory where the log files will be written.
    directory: String,
    /// A prefix for the log file names.
    prefix: String,
    /// The maximum number of rotated files to keep.
    max_files: u32,
  },
}

/// Telling Napi how to convert from a JS type to the enum
impl FromNapiValue for TracerMode {
  unsafe fn from_napi_value(
    env: napi::sys::napi_env,
    napi_val: napi::sys::napi_value,
  ) -> napi::Result<Self> {
    let object = JsObject::from_napi_value(env, napi_val)?;
    let mode = object.get_named_property::<JsString>("mode")?;
    let v = match mode.into_utf8()?.as_str()? {
      "disabled" => TracerMode::Disabled,
      "stdout" => TracerMode::Stdout,
      "file" => TracerMode::File {
        directory: object
          .get_named_property::<JsString>("directory")?
          .into_utf8()?
          .as_str()?
          .to_string(),
        prefix: object
          .get_named_property::<JsString>("prefix")?
          .into_utf8()?
          .as_str()?
          .to_string(),
        max_files: object
          .get_named_property::<JsNumber>("maxFiles")?
          .get_uint32()?,
      },
      _ => return Err(napi::Error::from_reason("Invalid tracer mode")),
    };
    Ok(v)
  }
}

/// Needs to exist for deserialization
impl ToNapiValue for TracerMode {
  unsafe fn to_napi_value(
    _env: napi::sys::napi_env,
    _val: Self,
  ) -> napi::Result<napi::sys::napi_value> {
    // we don't send this value back to JS
    unimplemented!()
  }
}

impl Default for TracerMode {
  #[cfg(not(debug_assertions))]
  fn default() -> Self {
    Self::File {
      directory: std::env::temp_dir()
        .join("parcel_trace")
        .to_string_lossy()
        .to_string(),
      prefix: "parcel-tracing".to_string(),
      max_files: 4,
    }
  }

  #[cfg(debug_assertions)]
  fn default() -> Self {
    Self::Stdout
  }
}

/// A reference counted guard that holds the tracer
/// open until all instances are dropped
pub struct Tracer {
  count: Arc<AtomicUsize>,
  worker_guard: Arc<Option<WorkerGuard>>,
}

impl Tracer {
  /// The Tracer can only be initialized once per process instance,
  /// subsequent invocations will reuse an existing instance
  pub fn new(mode: TracerMode) -> anyhow::Result<Self> {
    let mut global_tracer = GLOBAL_TRACER.lock();

    if let Some(global_tracer) = global_tracer.as_ref() {
      return Ok(global_tracer.clone());
    };

    let worker_guard = match mode {
      TracerMode::Disabled => None,
      TracerMode::Stdout => {
        tracing_subscriber::fmt().try_init().map_err(|err| {
          anyhow::anyhow!(err).context("Failed to setup stdout tracing, is another tracer running?")
        })?;
        None
      }
      TracerMode::File {
        directory,
        prefix,
        max_files,
      } => {
        let file_appender = tracing_appender::rolling::Builder::new()
          .rotation(tracing_appender::rolling::Rotation::HOURLY)
          .max_log_files(max_files as usize)
          .filename_prefix(&prefix)
          .build(&directory)
          .map_err(|err| anyhow::anyhow!(err))?;

        let (non_blocking, worker_guard) = tracing_appender::non_blocking(file_appender);

        tracing_subscriber::fmt()
          .with_writer(non_blocking)
          .try_init()
          .map_err(|err| {
            anyhow::anyhow!(err).context("Failed to setup file tracing, is another tracer running?")
          })?;

        Some(worker_guard)
      }
    };

    let tracer = Self {
      count: Arc::new(AtomicUsize::new(0)),
      worker_guard: Arc::new(worker_guard),
    };

    global_tracer.replace(tracer.clone());

    Ok(tracer)
  }
}

/// Increment reference count
impl Clone for Tracer {
  fn clone(&self) -> Self {
    self.count.fetch_add(1, Ordering::Relaxed);
    Self {
      count: self.count.clone(),
      worker_guard: self.worker_guard.clone(),
    }
  }
}

/// Decrement reference count, drop if no more references are held
impl Drop for Tracer {
  fn drop(&mut self) {
    let count = self.count.fetch_sub(1, Ordering::Relaxed);
    if count == 1 {
      drop(GLOBAL_TRACER.lock().take());
    }
  }
}
