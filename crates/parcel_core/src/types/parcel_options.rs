use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Deserializer;

/// The options passed into Parcel either through the CLI or the progrommatic API
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelOptions {
  pub config: Option<String>,
  pub default_config: Option<String>,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub mode: BuildMode,
  pub project_root: PathBuf,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BuildMode {
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

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
  Error,
  Info,
  None,
  Verbose,
  Warn,
}
