use std::fmt::Debug;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use mockall::automock;
use serde::Deserialize;

/// PackageManager abstraction instance
pub type PackageManagerRef = Arc<dyn PackageManager + Send + Sync>;

#[derive(Debug, Deserialize)]
pub struct Resolution {
  pub resolved: PathBuf,
}

#[automock]
pub trait PackageManager {
  fn resolve(&self, specifier: &str, from: &Path) -> anyhow::Result<Resolution>;
}
