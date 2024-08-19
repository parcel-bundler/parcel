//! This module configures `tracing_subscriber` to either write to a log file or standard output.
//!
//! Tracing is disabled by default.
use std::sync::Arc;

use anyhow::anyhow;
use serde::Deserialize;
use serde::Serialize;
use tracing_appender::non_blocking::WorkerGuard;

use crate::from_env::{optional_var, FromEnvError};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum TracerMode {
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

impl TracerMode {
  pub fn from_env() -> Result<Option<Self>, FromEnvError> {
    let Some(mode) = optional_var("ATLASPACK_TRACING_MODE") else {
      return Ok(None);
    };

    match &*mode {
      "file" => Ok(Some(Self::file())),
      "stdout" => Ok(Some(Self::stdout())),
      value => Err(FromEnvError::InvalidKey(
        String::from("ATLASPACK_TRACING_MODE"),
        anyhow!("Invalid value: {}", value),
      )),
    }
  }

  /// Default STDOUT configuration
  pub fn stdout() -> Self {
    Self::Stdout
  }

  /// Default file configuration
  pub fn file() -> Self {
    Self::File {
      directory: std::env::temp_dir()
        .join("atlaspack_trace")
        .to_string_lossy()
        .to_string(),
      prefix: "atlaspack-tracing".to_string(),
      max_files: 4,
    }
  }
}

pub struct Tracer {
  #[allow(unused)]
  worker_guard: Arc<Option<WorkerGuard>>,
}

impl Tracer {
  pub fn new(options: TracerMode) -> anyhow::Result<Self> {
    let worker_guard = match options {
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
}

#[cfg(test)]
mod test {
  use super::*;

  static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

  #[test]
  fn test_tracing_options_sets_to_none_if_no_mode_is_set() {
    let _guard = TEST_LOCK.lock();
    std::env::remove_var("ATLASPACK_TRACING_MODE");
    let options = TracerMode::from_env().unwrap();
    assert!(options.is_none());
  }

  #[test]
  fn test_tracing_options_sets_to_file() {
    let _guard = TEST_LOCK.lock();
    std::env::set_var("ATLASPACK_TRACING_MODE", "stdout");
    let options = TracerMode::from_env().unwrap().unwrap();
    assert!(matches!(options, TracerMode::Stdout));
  }

  #[test]
  fn test_tracing_options_sets_to_stdout() {
    let _guard = TEST_LOCK.lock();
    std::env::set_var("ATLASPACK_TRACING_MODE", "file");
    let options = TracerMode::from_env().unwrap().unwrap();
    assert!(matches!(options, TracerMode::File { .. }));
  }
}
