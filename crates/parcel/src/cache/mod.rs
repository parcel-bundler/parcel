use std::path::Path;

use heed::types::{Bytes, Str};
use heed::{EnvFlags, EnvOpenOptions, RoTxn};

use parcel_core::cache::Cache;

type Database = heed::Database<Str, Bytes>;

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
  database: Database,
}

impl LMDBCache {
  #[allow(unused)]
  pub fn new(options: LMDBCacheOptions) -> anyhow::Result<Self> {
    let rust_cache_path = Path::new(".parcel-cache/rust-cache");
    std::fs::create_dir_all(rust_cache_path)?;
    let environment = unsafe {
      let mut flags = EnvFlags::empty();
      flags.set(EnvFlags::MAP_ASYNC, options.async_writes);
      flags.set(EnvFlags::NO_SYNC, options.async_writes);
      flags.set(EnvFlags::NO_META_SYNC, options.async_writes);
      EnvOpenOptions::new()
        // http://www.lmdb.tech/doc/group__mdb.html#gaa2506ec8dab3d969b0e609cd82e619e5
        // 10GB max DB size that will be memory mapped
        .map_size(40 * 1024 * 1024 * 1024)
        .flags(flags)
        .open(rust_cache_path)
    }?;
    let mut write_txn = environment.write_txn()?;
    let database = environment.create_database(&mut write_txn, None)?;
    write_txn.commit()?;

    Ok(Self {
      environment,
      database,
    })
  }

  pub fn close(self) {
    let event = self.environment.prepare_for_closing();
    event.wait();
  }
}

impl LMDBCache {
  pub fn environment(&self) -> &heed::Env {
    &self.environment
  }

  pub fn database(&self) -> &Database {
    &self.database
  }

  pub fn get_blob_ref<'a>(&self, transaction: &'a RoTxn, key: &str) -> anyhow::Result<&'a [u8]> {
    let output = self
      .database
      .get(&transaction, &key)?
      .ok_or_else(|| anyhow::anyhow!("Key not found"))?;
    Ok(output)
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
    let output = self.get_blob_ref(&transaction, key)?;
    Ok(output.to_vec()) // TODO: We don't need to allocate
  }
}

pub struct LMDBCacheOptions {
  /// Non-durable writes
  pub async_writes: bool,
}

impl Default for LMDBCacheOptions {
  fn default() -> Self {
    LMDBCacheOptions { async_writes: true }
  }
}

#[cfg(test)]
mod test {
  use rand::random;
  use rkyv::rancor::{Failure, Panic};
  use rkyv::{from_bytes, to_bytes};

  use parcel_core::types::Asset;

  use crate::requests::asset_request::AssetRequestOutput;
  use crate::requests::RequestResult;

  use super::*;

  #[test]
  fn test_e2e_cache_write() {
    let cache = LMDBCache::new(Default::default()).unwrap();
    cache.set_blob("key1", "data".as_bytes()).unwrap();
    assert_eq!(cache.get_blob("key1").unwrap(), "data".as_bytes());
  }

  #[test]
  fn test_write_request() {
    let cache = LMDBCache::new(Default::default()).unwrap();
    let asset = Asset::default();
    let request_result = RequestResult::Asset(AssetRequestOutput {
      asset,
      dependencies: vec![],
    });
    let cache_key = random::<u64>().to_string();
    let bytes = to_bytes::<_, 256, Panic>(&request_result).unwrap();
    cache.set_blob(&cache_key, bytes.as_slice()).unwrap();

    let txn = cache.environment().read_txn().unwrap();
    let blob = cache.get_blob_ref(&txn, &cache_key).unwrap();
    assert_eq!(blob, bytes.as_slice());
    let _request_result: RequestResult = from_bytes::<RequestResult, Panic>(&blob).unwrap();
  }

  #[test]
  fn test_round_trip_serialize() {
    let cache = LMDBCache::new(Default::default()).unwrap();
    let asset = Asset::default();
    let request_result = RequestResult::Asset(AssetRequestOutput {
      asset,
      dependencies: vec![],
    });
    let cache_key = random::<u64>().to_string();
    let mut bytes = to_bytes::<_, 256, Panic>(&request_result).unwrap();
    bytes.shrink_to_fit();
    let copy = bytes.as_slice().to_vec();
    cache.set_blob(&cache_key, bytes.as_slice()).unwrap();
    let blob_vec = cache.get_blob(&cache_key).unwrap();
    let txn = cache.environment().read_txn().unwrap();
    let blob = cache.get_blob_ref(&txn, &cache_key).unwrap();
    assert_eq!(blob_vec, bytes.as_slice());
    assert_eq!(blob, bytes.as_slice());

    let _request_result: RequestResult =
      from_bytes::<RequestResult, Panic>(&bytes.as_slice()).unwrap();
    let _request_result: RequestResult = from_bytes::<RequestResult, Panic>(&copy).unwrap();
    let _request_result: RequestResult = from_bytes::<RequestResult, Panic>(&blob_vec).unwrap();
    assert_eq!(blob, bytes.as_slice());
    let blob_copy = blob.to_vec();
    let _request_result = from_bytes::<RequestResult, Panic>(&blob_copy).unwrap();
    assert_eq!(blob, bytes.as_slice());
    let request_result = from_bytes::<RequestResult, Failure>(&blob);
    assert_eq!(blob, bytes.as_slice());
    let request_result2 = from_bytes::<RequestResult, Failure>(&bytes.as_slice());
    request_result2.unwrap();
    request_result.unwrap();

    txn.commit().unwrap();
  }
}
