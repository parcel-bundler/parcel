use criterion::{Criterion, criterion_group, criterion_main};
use std::{hint::black_box, path::Path, sync::Arc};

fn parcel(from: &Path, resolver: &parcel_resolver::Resolver) {
  for specifier in &[
    "./nested/index.js",
    "@parcel/core",
    "axios",
    "@babel/parser",
  ] {
    let _ = black_box(resolver.resolve(
      black_box(specifier),
      &from,
      parcel_resolver::SpecifierType::Esm,
    ));
  }
}

fn bench_uncached(c: &mut Criterion) {
  let root = Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .unwrap()
    .parent()
    .unwrap()
    .join("packages/utils/node-resolver-core/test/fixture");
  let from = root.join("foo.js");
  let fs: Arc<dyn parcel_resolver::FileSystem> = Arc::new(parcel_resolver::OsFileSystem::default());
  c.bench_function("uncached/parcel_resolver", |b| {
    b.iter(|| {
      let cache = parcel_resolver::Cache::new(Arc::clone(&fs));
      let resolver = parcel_resolver::Resolver::node_esm(&root, &cache);
      parcel(&from, &resolver)
    })
  });
}

fn bench_cached(c: &mut Criterion) {
  let root = Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .unwrap()
    .parent()
    .unwrap()
    .join("packages/utils/node-resolver-core/test/fixture");
  let from = root.join("foo.js");
  let fs: Arc<dyn parcel_resolver::FileSystem> = Arc::new(parcel_resolver::OsFileSystem::default());
  let cache = parcel_resolver::Cache::new(Arc::clone(&fs));
  let resolver = parcel_resolver::Resolver::node_esm(&root, &cache);
  c.bench_function("cached/parcel_resolver", |b| {
    b.iter(|| parcel(&from, &resolver))
  });
}

criterion_group!(benches, bench_uncached, bench_cached);
criterion_main!(benches);
