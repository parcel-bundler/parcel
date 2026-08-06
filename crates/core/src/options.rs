use std::{borrow::Cow, collections::HashMap, sync::Arc};

use serde::Deserialize;

use crate::{OsFileSystem, PathId, TargetSourceMapOptions, fs::FileSystem};

#[derive(Clone)]
pub struct BuildOptions {
  pub mode: BuildMode,
  pub optimize: Option<bool>,
  pub source_map: Option<TargetSourceMapOptions>,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub input_fs: Arc<dyn FileSystem>,
  pub output_fs: Arc<dyn FileSystem>,
  pub config: Option<String>,
  pub cwd: PathId,
  pub dist_dir: Option<PathId>,
  pub public_url: String,
  pub hmr: Option<HmrOptions>,
}

pub struct ParcelOptions {
  pub mode: BuildMode,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub project_root: PathId,
  pub input_fs: Arc<dyn FileSystem>,
  pub output_fs: Arc<dyn FileSystem>,
  pub cwd: PathId,
  pub hmr: Option<HmrOptions>,
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
      hmr: None,
    }
  }
}

#[derive(Clone)]
pub struct HmrOptions {
  pub host: Cow<'static, str>,
  pub port: u16,
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
