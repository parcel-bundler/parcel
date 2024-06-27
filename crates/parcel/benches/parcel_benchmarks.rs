use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use rand::random;
use rkyv::rancor::{BoxedError, Failure, Panic};

use parcel::cache::LMDBCache;
use parcel::requests::asset_request::AssetRequestOutput;
use parcel::requests::{ArchivedRequestResult, RequestResult};
use parcel_core::cache::Cache;
use parcel_core::types::Asset;

/// Benchmark writes and serialization to LMDB
pub fn cache_benchmark(c: &mut Criterion) {
  struct BenchmarkItem {
    request_result: RequestResult,
    cache_key: String,
  }

  let cache = LMDBCache::new().unwrap();
  let setup = || {
    let asset = Asset::default();
    let request_result = RequestResult::Asset(AssetRequestOutput {
      asset,
      dependencies: vec![],
    });
    let cache_key = random::<u64>().to_string();
    BenchmarkItem {
      request_result,
      cache_key,
    }
  };

  c.bench_function("serialize request", |b| {
    b.iter_batched(
      setup,
      |BenchmarkItem { request_result, .. }| {
        let bytes = rkyv::to_bytes::<RequestResult, 256, Failure>(&request_result).unwrap();
        black_box(bytes);
      },
      BatchSize::SmallInput,
    );
  });

  c.bench_function("write request to cache one at a time", |b| {
    b.iter_batched(
      setup,
      |BenchmarkItem {
         request_result,
         cache_key,
         ..
       }| {
        let bytes = rkyv::to_bytes::<RequestResult, 256, Failure>(&request_result).unwrap();
        cache.set_blob(&cache_key, bytes.as_ref()).unwrap();
      },
      BatchSize::SmallInput,
    );
  });
  c.bench_function("read request to cache one at a time", |b| {
    b.iter_batched(
      || {
        let BenchmarkItem {
          request_result,
          cache_key,
          ..
        } = setup();
        let bytes = rkyv::to_bytes::<RequestResult, 256, Failure>(&request_result).unwrap();
        cache.set_blob(&cache_key, bytes.as_slice()).unwrap();

        cache_key
      },
      |cache_key| {
        let txn = cache.environment().read_txn().unwrap();
        let blob = cache.get_blob_ref(&txn, &cache_key).unwrap();
        let request_result: &ArchivedRequestResult =
          rkyv::access::<ArchivedRequestResult, Panic>(&blob).unwrap();
        black_box(request_result);
      },
      BatchSize::SmallInput,
    );
  });

  c.bench_function("write 1000 requests to cache one at a time", |b| {
    b.iter_batched(
      || {
        let mut items = vec![];
        for _i in 0..1000 {
          items.push(setup())
        }
        items
      },
      |items| {
        let mut write_txn = cache.environment().write_txn().unwrap();

        for BenchmarkItem {
          request_result,
          cache_key,
          ..
        } in items
        {
          let bytes = rkyv::to_bytes::<RequestResult, 256, Failure>(&request_result).unwrap();
          cache
            .database()
            .put(&mut write_txn, &cache_key, bytes.as_ref())
            .unwrap();
        }

        write_txn.commit().unwrap();
      },
      BatchSize::PerIteration,
    );
  });
}

criterion_group!(benches, cache_benchmark);
criterion_main!(benches);
