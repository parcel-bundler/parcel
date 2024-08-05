use thiserror::Error;

#[derive(Error, Debug)]
pub enum FromEnvError {
  #[error("Missing required environment variable {0}: {1}")]
  MissingKey(String, std::env::VarError),
  #[error("Invalid value for environment variable {0}: {1}")]
  InvalidKey(String, anyhow::Error),
}

#[allow(unused)]
pub fn required_var(key: &str) -> Result<String, FromEnvError> {
  let value = std::env::var(key).map_err(|err| FromEnvError::MissingKey(key.to_string(), err))?;
  Ok(value)
}

pub fn optional_var(key: &str) -> Option<String> {
  std::env::var(key).ok()
}
