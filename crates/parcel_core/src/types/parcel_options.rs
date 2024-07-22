use std::collections::HashMap;
use std::fmt::Display;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Deserializer;
use serde::Serialize;

use super::engines::Engines;
use super::OutputFormat;

/// The options passed into Parcel either through the CLI or the programmatic API
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelOptions {
  pub config: Option<String>,

  /// Path to the parcel core node_module. This will be used to resolve built-ins or runtime files.
  ///
  /// In the future this may be replaced with embedding those files into the rust binary.
  pub core_path: PathBuf,

  #[serde(default)]
  pub default_target_options: DefaultTargetOptions,

  pub entries: Vec<String>,
  pub env: Option<HashMap<String, String>>,

  #[serde(rename = "defaultConfig")]
  pub fallback_config: Option<String>,

  #[serde(default)]
  pub log_level: LogLevel,

  #[serde(default)]
  pub mode: BuildMode,
}

#[derive(Clone, Debug, Default, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
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

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
pub struct DefaultTargetOptions {
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

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
  #[default]
  Error,
  Info,
  None,
  Verbose,
  Warn,
}
