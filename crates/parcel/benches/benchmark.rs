use criterion::{Criterion, criterion_group, criterion_main};
use parcel_core::PathId;
use std::{path::Path, sync::Arc};

#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn bench_dev(c: &mut Criterion) {
  let os: Arc<dyn parcel_resolver::FileSystem> = Arc::new(parcel_resolver::OsFileSystem::default());
  c.bench_function("dev", |b| {
    b.iter(|| {
      let fs = parcel_core::CachedFileSystem::new(Arc::clone(&os));
      parcel::build(&vec!["/Users/devongovett/dev/react-spectrum/packages/dev/storybook-builder-parcel/generated-entries/iframe.html".into()], parcel_core::BuildOptions {
        env: Default::default(),
        input_fs: Arc::new(fs),
        output_fs: os.clone(),
        log_level: parcel_core::LogLevel::Verbose,
        mode: parcel_core::BuildMode::Development,
        minify: None,
        config: Some("/Users/devongovett/dev/react-spectrum/.storybook-s2/.parcelrc".into()),
        cwd: PathId::new(Path::new("/Users/devongovett/dev/react-spectrum")),
      }).expect("build failed");
    })
  });
}

fn bench_prod(c: &mut Criterion) {
  let os: Arc<dyn parcel_resolver::FileSystem> = Arc::new(parcel_resolver::OsFileSystem::default());
  c.bench_function("prod", |b| {
    b.iter(|| {
      let fs = parcel_core::CachedFileSystem::new(Arc::clone(&os));
      parcel::build(&vec!["/Users/devongovett/dev/react-spectrum/packages/dev/storybook-builder-parcel/generated-entries/iframe.html".into()], parcel_core::BuildOptions {
        env: Default::default(),
        input_fs: Arc::new(fs),
        output_fs: os.clone(),
        log_level: parcel_core::LogLevel::Verbose,
        mode: parcel_core::BuildMode::Production,
        minify: None,
        config: Some("/Users/devongovett/dev/react-spectrum/.storybook-s2/.parcelrc".into()),
        cwd: PathId::new(Path::new("/Users/devongovett/dev/react-spectrum")),
      }).expect("build failed");
    })
  });
}

criterion_group! {
    name = benches;
    config = Criterion::default().sample_size(10);
    targets = bench_dev //, bench_prod
}
criterion_main!(benches);
