use std::collections::HashMap;
use std::fmt::Display;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Deserializer;

use super::engines::Engines;
use super::OutputFormat;

/// The options passed into Parcel either through the CLI or the programmatic API
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelOptions {
  pub config: Option<String>,
  pub default_config: Option<String>,
  pub default_target_options: DefaultTargetOptions,
  pub entries: Option<Entry>,
  pub env: Option<HashMap<String, String>>,
  pub log_level: LogLevel,
  pub mode: BuildMode,
  pub project_root: PathBuf,
  /// Path to the parcel core node_module. This will be used to resolve built-ins or runtime files.
  ///
  /// In the future this may be replaced with embedding those files into the rust binary.
  pub core_path: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Hash)]
pub enum Entry {
  Single(String),
  Multiple(Vec<String>),
}

impl Default for Entry {
  fn default() -> Self {
    Entry::Single(String::default())
  }
}

#[derive(
  Clone, Debug, Default, Hash, PartialEq, rkyv::Archive, rkyv::Serialize, rkyv::Deserialize,
)]
pub enum BuildMode {
  #[default]
  Development,
  Production,
  Other(String),
}

impl Display for BuildMode {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      BuildMode::Development => write!(f, "development"),
      BuildMode::Production => write!(f, "production"),
      BuildMode::Other(mode) => write!(f, "{}", mode.to_lowercase()),
    }
  }
}

impl<'de> Deserialize<'de> for BuildMode {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: Deserializer<'de>,
  {
    let s = String::deserialize(deserializer)?;

    Ok(match s.as_str() {
      "development" => BuildMode::Development,
      "production" => BuildMode::Production,
      _ => BuildMode::Other(s),
    })
  }
}

#[derive(Clone, Debug, Deserialize, Hash, rkyv::Archive, rkyv::Serialize, rkyv::Deserialize)]
pub struct DefaultTargetOptions {
  #[with(rkyv::with::Map<rkyv::with::AsString>)]
  pub dist_dir: Option<PathBuf>,
  pub engines: Engines,
  pub is_library: bool,
  pub output_format: Option<OutputFormat>,
  pub public_url: String,
  pub should_optimize: bool,
  pub should_scope_hoist: bool,
  pub source_maps: bool,
}

impl Default for DefaultTargetOptions {
  fn default() -> Self {
    Self {
      dist_dir: None,
      engines: Engines::default(),
      is_library: false,
      output_format: None,
      public_url: String::from("/"),
      should_optimize: false,
      should_scope_hoist: false,
      source_maps: false,
    }
  }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
  #[default]
  Error,
  Info,
  None,
  Verbose,
  Warn,
}
