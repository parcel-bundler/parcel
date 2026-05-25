use std::{collections::HashMap, path::PathBuf, sync::Arc};

use serde::Deserialize;

use crate::{OsFileSystem, SourceUrl, fs::FileSystem};

#[derive(Clone)]
pub struct BuildOptions {
  pub mode: BuildMode,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub input_fs: Arc<dyn FileSystem>,
  pub output_fs: Arc<dyn FileSystem>,
  pub config: Option<String>,
  pub cwd: PathBuf,
}

pub struct ParcelOptions {
  pub mode: BuildMode,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub project_root: SourceUrl,
  pub input_fs: Arc<dyn FileSystem>,
  pub output_fs: Arc<dyn FileSystem>,
  pub cwd: PathBuf,
}

impl Default for ParcelOptions {
  fn default() -> Self {
    ParcelOptions {
      mode: Default::default(),
      env: Default::default(),
      log_level: Default::default(),
      project_root: Default::default(),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: Arc::new(OsFileSystem {}),
      cwd: std::env::current_dir().unwrap(),
    }
  }
}

#[derive(Clone, PartialEq, Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildMode {
  #[default]
  Development,
  Production,
  #[serde(untagged)]
  Other(String),
}

#[derive(Clone, PartialEq, Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
  None,
  Error,
  Warn,
  #[default]
  Info,
  Verbose,
}
