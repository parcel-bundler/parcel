use criterion::{criterion_group, criterion_main, Criterion};
use parcel_filesystem::os_file_system::OsFileSystem;
use parcel_resolver::{Cache, CacheCow, Resolver, SpecifierType};
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn root() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .unwrap()
    .join("node-resolver-core/test/fixture")
}

fn criterion_benchmark(c: &mut Criterion) {
  let make_resolver = || {
    Resolver::parcel(
      root().into(),
      CacheCow::Owned(Cache::new(Arc::new(OsFileSystem))),
    )
  };
  // c.bench_function("is file using stat", |b| {
  //   let target = root().join("do-not-exist");
  //   b.iter(|| {
  //     black_box(target.exists())
  //   });
  // });
  // c.bench_function("is file using open", |b| {
  //   let target = root().join("do-not-exist");
  //   b.iter(|| {
  //     black_box(std::fs::read_to_string(&target).is_err())
  //   });
  // });

  c.bench_function("resolver simple", |b| {
    b.iter_with_setup(
      || make_resolver(),
      |resolver| {
        let result = resolver
          .resolve("./bar.js", &root().join("foo.js"), SpecifierType::Esm)
          .result
          .unwrap();
        black_box(result)
      },
    );
  });

  c.bench_function("resolver modules", |b| {
    b.iter_with_setup(
      || make_resolver(),
      |resolver| {
        let result = resolver
          .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Cjs)
          .result
          .unwrap();
        black_box(result)
      },
    );
  });
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);
