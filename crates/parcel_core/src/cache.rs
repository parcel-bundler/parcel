use std::sync::Arc;

use anyhow::anyhow;

pub type CacheRef = Arc<dyn Cache + Sync + Send>;

pub trait Cache {
  fn set_blob(&self, _key: &str, _blob: &[u8]) -> anyhow::Result<()> {
    Err(anyhow!("Not implmented"))
  }
}
