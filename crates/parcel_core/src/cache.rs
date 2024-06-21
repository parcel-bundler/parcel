use std::sync::Arc;

pub type CacheRef = Arc<dyn Cache + Sync + Send>;

#[mockall::automock]
pub trait Cache {
  fn set_blob(&self, key: &str, blob: &[u8]) -> anyhow::Result<()>;
  fn get_blob(&self, key: &str) -> anyhow::Result<Vec<u8>>;
}
