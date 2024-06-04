use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
  #[error("{0}")]
  InvalidConfig(String),
  #[error("Unable to locate .parcelrc from {0}")]
  MissingParcelRc(PathBuf),
  #[error("Failed to parse {path}")]
  ParseFailure {
    path: PathBuf,
    #[source]
    source: serde_json5::Error,
  },
  #[error("Failed to read {path}")]
  ReadConfigFile {
    path: PathBuf,
    #[source]
    source: std::io::Error,
  },
  #[error("Failed to resolve {config_type} {specifier} from {from}")]
  UnresolvedConfig {
    config_type: String,
    from: PathBuf,
    specifier: String,
    #[source]
    source: Box<anyhow::Error>,
  },
}
