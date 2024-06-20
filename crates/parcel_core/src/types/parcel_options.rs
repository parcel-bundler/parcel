use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Deserializer;

/// The options passed into Parcel either through the CLI or the programmatic API
#[derive(Default, Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelOptions {
  pub config: Option<String>,
  pub default_config: Option<String>,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub mode: BuildMode,
  pub project_root: PathBuf,
  /// Path to the parcel core node_module. This will be used to resolve built-ins or runtime files.
  ///
  /// In the future this may be replaced with embedding those files into the rust binary.
  pub core_path: PathBuf,
}

#[derive(Clone, Debug, Default, Hash, PartialEq)]
pub enum BuildMode {
  #[default]
  Development,
  Production,
  Other(String),
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

#[derive(Default, Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
  #[default]
  Error,
  Info,
  None,
  Verbose,
  Warn,
}
