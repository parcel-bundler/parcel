use std::path::Path;

use lmdb::Transaction;

use parcel_core::cache::Cache;

pub struct LMDBCache {
  environment: lmdb::Environment,
  database: lmdb::Database,
}

impl LMDBCache {
  pub fn new() -> anyhow::Result<Self> {
    let rust_cache_path = Path::new(".parcel-cache/rust-cache");
    std::fs::create_dir_all(rust_cache_path)?;
    let environment = lmdb::Environment::new().open(&rust_cache_path)?;
    let database = environment.open_db(None)?;
    Ok(Self {
      environment,
      database,
    })
  }
}

fn make_rust_db_key(key: &str) -> String {
  format!("parcel_rust:{}", key)
}

impl Cache for LMDBCache {
  fn set_blob(&self, key: &str, blob: &[u8]) -> anyhow::Result<()> {
    // LMDB performance is orders of magnitude higher if we batch writes/reads into transactions.
    // therefore this implementation / API is not good as we'll force commits on every write.
    //
    // Instead, we should be heavily using transactions so that an entire batch of writes can be
    // committed at once. This both ensure consistency of the DB and improves performance as all
    // reads will come from memory, and all writes will be instantaneous.
    let mut transaction = self.environment.begin_rw_txn()?;

    // TODO: Generally this LMDB crate has design flaws
    // it requires us to convert types to owned rather than passing references.
    // we should consider which wrapper or database back-end to use, ideally a mature implementation.
    let key = make_rust_db_key(key);
    let blob = blob.to_vec();
    transaction.put(self.database, &key, &blob, lmdb::WriteFlags::empty())?;
    transaction.commit()?;
    Ok(())
  }

  fn get_blob(&self, key: &str) -> anyhow::Result<Vec<u8>> {
    let transaction = self.environment.begin_ro_txn()?;
    let key = make_rust_db_key(key);
    let output = transaction.get(self.database, &key)?;
    Ok(output.to_vec())
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
