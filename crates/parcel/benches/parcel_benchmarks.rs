use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use rand::random;
use rkyv::rancor::Failure;

use parcel::cache::LMDBCache;
use parcel::requests::asset_request::AssetRequestOutput;
use parcel::requests::RequestResult;
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

  c.bench_function("serialize request using bincode to_bytes", |b| {
    let mut output = vec![];
    output.resize(10000, 0); // pre-alloc
    b.iter_batched(
      setup,
      |BenchmarkItem { request_result, .. }| {
        bincode::encode_into_slice(&request_result, &mut output, bincode::config::standard())
          .unwrap();
        black_box(&output);
      },
      BatchSize::SmallInput,
    );
  });

  c.bench_function("serialize request using rkyv to_bytes", |b| {
    b.iter_batched(
      setup,
      |BenchmarkItem { request_result, .. }| {
        let bytes = rkyv::to_bytes::<RequestResult, 256, Failure>(&request_result).unwrap();
        black_box(bytes);
      },
      BatchSize::SmallInput,
    );
  });

  c.bench_function(
    "write request to cache one at a time using bincode to serialize",
    |b| {
      let mut scratch = vec![];
      scratch.resize(10000, 0); // pre-alloc
      b.iter_batched(
        setup,
        |BenchmarkItem {
           request_result,
           cache_key,
           ..
         }| {
          bincode::encode_into_slice(&request_result, &mut scratch, bincode::config::standard())
            .unwrap();
          cache.set_blob(&cache_key, &scratch).unwrap();
        },
        BatchSize::SmallInput,
      );
    },
  );

  c.bench_function("write 1000 requests to cache at a time", |b| {
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

        let mut scratch = vec![];
        scratch.resize(10000, 0); // pre-alloc
        for BenchmarkItem {
          request_result,
          cache_key,
          ..
        } in items
        {
          bincode::encode_into_slice(&request_result, &mut scratch, bincode::config::standard())
            .unwrap();
          cache
            .database()
            .put(&mut write_txn, &cache_key, &scratch)
            .unwrap();
        }

        write_txn.commit().unwrap();
      },
      BatchSize::PerIteration,
    );
  });

  c.bench_function("read request to cache one at a time", |b| {
    let mut scratch = vec![];
    scratch.resize(10000, 0); // pre-alloc

    b.iter_batched(
      || {
        let BenchmarkItem {
          request_result,
          cache_key,
          ..
        } = setup();
        bincode::encode_into_slice(&request_result, &mut scratch, bincode::config::standard())
          .unwrap();
        cache.set_blob(&cache_key, &scratch).unwrap();

        cache_key
      },
      |cache_key: String| {
        let txn = cache.environment().read_txn().unwrap();
        let blob = cache.get_blob_ref(&txn, &cache_key).unwrap();
        let request_result: (RequestResult, _) =
          bincode::decode_from_slice(&blob, bincode::config::standard()).unwrap();
        black_box(request_result);
      },
      BatchSize::SmallInput,
    );
  });
}

criterion_group!(benches, cache_benchmark);
criterion_main!(benches);
