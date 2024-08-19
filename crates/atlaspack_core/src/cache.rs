use std::sync::Arc;

pub type CacheRef = Arc<dyn Cache + Sync + Send>;

#[mockall::automock]
pub trait Cache {
  fn set_blob(&self, _key: &str, _blob: &[u8]) -> anyhow::Result<()>;
}
