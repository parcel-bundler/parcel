use parcel_core::Parcel;

#[cfg(target_os = "macos")]
#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

fn main() {
  let parcel = Parcel::new();
  // parcel.run("/Users/devongovett/dev/parcel/packages/core/integration-tests/test/integration/commonjs/index.js".into());
  parcel.run("/Users/devongovett/Downloads/bundler-benchmark/cases/all/src/index.js".into());
}
