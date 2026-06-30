use std::{collections::HashMap, sync::Arc};

use serde::Deserialize;

use crate::{OsFileSystem, PathId, fs::FileSystem};

#[derive(Clone)]
pub struct BuildOptions {
  pub mode: BuildMode,
  pub minify: Option<bool>,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub input_fs: Arc<dyn FileSystem>,
  pub output_fs: Arc<dyn FileSystem>,
  pub config: Option<String>,
  pub cwd: PathId,
}

pub struct ParcelOptions {
  pub mode: BuildMode,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub project_root: PathId,
  pub input_fs: Arc<dyn FileSystem>,
  pub output_fs: Arc<dyn FileSystem>,
  pub cwd: PathId,
}

impl Default for ParcelOptions {
  fn default() -> Self {
    ParcelOptions {
      mode: Default::default(),
      env: Default::default(),
      log_level: Default::default(),
      project_root: PathId::root(),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: Arc::new(OsFileSystem {}),
      cwd: PathId::new(&std::env::current_dir().unwrap()),
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
