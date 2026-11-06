use criterion::{Criterion, criterion_group, criterion_main};
use parcel_core::PathId;
use std::{path::Path, sync::Arc};

#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn bench_three(c: &mut Criterion) {
  let os: Arc<dyn parcel_resolver::FileSystem> = Arc::new(parcel_resolver::OsFileSystem::default());
  c.bench_function("prod", |b| {
    b.iter(|| {
      let fs = parcel_core::CachedFileSystem::new(Arc::clone(&os));
      parcel::build(
        &vec!["entry.parcel2.js".into()],
        parcel_core::BuildOptions {
          env: Default::default(),
          input_fs: Arc::new(fs),
          output_fs: os.clone(),
          log_level: parcel_core::LogLevel::Info,
          mode: parcel_core::BuildMode::Development,
          optimize: None,
          content_hash: None,
          source_map: Some(Default::default()),
          config: None,
          cwd: PathId::new(Path::new(
            "/Users/devongovett/dev/esbuild/require/parcel2/bench/three",
          )),
          dist_dir: None,
          public_url: Default::default(),
          hmr: None,
          reporters: Vec::new(),
        },
      )
      .expect("build failed");
    })
  });
}

criterion_group! {
    name = benches;
    config = Criterion::default().sample_size(10);
    targets = bench_three
}
criterion_main!(benches);
