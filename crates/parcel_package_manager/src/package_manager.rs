use std::path::Path;
use std::path::PathBuf;

use mockall::automock;
use thiserror::Error;

pub struct Resolution {
  pub resolved: PathBuf,
}

#[derive(Debug, Error)]
pub enum ResolveError {
  #[error("{0}")]
  JsError(String),
  #[error("Cannot find module '{0}' from {1}")]
  NotFound(String, String),
}

#[automock]
pub trait PackageManager {
  fn resolve(&self, specifier: &str, from: &Path) -> Result<Resolution, ResolveError>;
}
