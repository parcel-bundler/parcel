use std::sync::Arc;

use anyhow::anyhow;
use mockall::automock;

pub type CacheRef = Arc<dyn Cache + Sync + Send>;

#[automock]
pub trait Cache {
  fn set_blob(&self, _key: &str, _blob: &str) -> anyhow::Result<()> {
    Err(anyhow!("Not implmented"))
  }
}
