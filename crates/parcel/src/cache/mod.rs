use std::path::Path;

use heed::types::{Bytes, Str};
use heed::EnvOpenOptions;

use parcel_core::cache::Cache;

/// Implements a `lmdb` cache back-end using [`heed`].
///
/// This should change as we progress because we would want to:
///
/// * We want the cache to be able to store data and be opinionated about the serialization format
/// * Cache keys don't need to be strings; ideally they'll be strongly typed enums which we will
///   implement efficient serialization into nice keys we can iterate and lookup efficiently
/// * Entries should use binary serialization. Ideally with zero-copy. Zero copy de-serialization
///   can be implemented over LMDB using `rkyv`.
/// * We don't need to allocate when returning the entries
pub struct LMDBCache {
  environment: heed::Env,
  database: heed::Database<Str, Bytes>,
}

impl LMDBCache {
  #[allow(unused)]
  pub fn new() -> anyhow::Result<Self> {
    let rust_cache_path = Path::new(".parcel-cache/rust-cache");
    std::fs::create_dir_all(rust_cache_path)?;
    let environment = unsafe { EnvOpenOptions::new().open(rust_cache_path) }?;
    let mut write_txn = environment.write_txn()?;
    let database = environment.create_database(&mut write_txn, None)?;
    write_txn.commit()?;

    Ok(Self {
      environment,
      database,
    })
  }
}

impl Cache for LMDBCache {
  fn set_blob(&self, key: &str, blob: &[u8]) -> anyhow::Result<()> {
    // LMDB performance is orders of magnitude higher if we batch writes/reads into transactions.
    // therefore this implementation / API is not good as we'll force commits on every write.
    //
    // Instead, we should be heavily using transactions so that an entire batch of writes can be
    // committed at once. This both ensure consistency of the DB and improves performance as all
    // reads will come from memory, and all writes will be instantaneous.
    let mut transaction = self.environment.write_txn()?;
    self.database.put(&mut transaction, &key, &blob)?;
    transaction.commit()?;
    Ok(())
  }

  fn get_blob(&self, key: &str) -> anyhow::Result<Vec<u8>> {
    let transaction = self.environment.read_txn()?;
    let output = self
      .database
      .get(&transaction, &key)?
      .ok_or_else(|| anyhow::anyhow!("Key not found"))?;
    Ok(output.to_vec()) // TODO: We don't need to allocate
  }
}

#[cfg(test)]
mod test {
  use super::*;

  #[test]
  fn test_e2e_cache_write() {
    let cache = LMDBCache::new().unwrap();
    cache.set_blob("key1", "data".as_bytes()).unwrap();
    assert_eq!(cache.get_blob("key1").unwrap(), "data".as_bytes());
  }
}
