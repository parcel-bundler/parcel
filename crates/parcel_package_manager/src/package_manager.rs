use std::path::Path;
use std::path::PathBuf;

use mockall::automock;

pub struct Resolution {
  pub resolved: PathBuf,
}

#[automock]
pub trait PackageManager {
  fn resolve(&self, specifier: &str, from: &Path) -> anyhow::Result<Resolution>;
}
