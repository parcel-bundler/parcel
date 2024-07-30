use std::sync::Arc;

use napi::Env;
use napi::JsObject;
use serde::Deserialize;
use serde::Serialize;
use tracing_appender::non_blocking::WorkerGuard;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum TracerMode {
  /// Disable the Tracer
  Disabled,
  /// Output the Tracer logs to Stdout
  Stdout,
  /// Output the Tracer logs to a file
  #[serde(rename_all = "camelCase")]
  File {
    /// The directory where the log files will be written.
    directory: String,
    /// A prefix for the log file names.
    prefix: String,
    /// The maximum number of rotated files to keep.
    max_files: u32,
  },
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

impl TracerMode {
  pub fn from_js_value(env: &Env, js_object: Option<JsObject>) -> napi::Result<Self> {
    if let Some(mode) = js_object {
      env.from_js_value(mode)
    } else {
      Ok(TracerMode::default())
    }
  }
}

pub struct Tracer {
  worker_guard: Arc<Option<WorkerGuard>>,
}

impl Tracer {
  pub fn new(mode: TracerMode) -> anyhow::Result<Self> {
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
      worker_guard: Arc::new(worker_guard),
    };

    Ok(tracer)
  }

  pub fn dummy() -> Self {
    Self {
      worker_guard: Default::default(),
    }
  }
}
