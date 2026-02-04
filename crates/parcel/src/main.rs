use std::{collections::HashMap, path::Path, sync::Arc};

use parcel_core::{OsFileSystem, ParcelOptions, SourceUrl};

pub fn main() {
  let mode = parcel_core::BuildMode::Development;
  let mut env = HashMap::new();
  env.insert(
    "NODE_ENV".into(),
    if mode == parcel_core::BuildMode::Production {
      "production".into()
    } else {
      "development".into()
    },
  );
  let options = Arc::new(ParcelOptions {
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: Arc::new(OsFileSystem {}),
    log_level: parcel_core::LogLevel::Verbose,
    mode,
    project_root: SourceUrl::from_path(Path::new(
      "/Users/devongovett/dev/parcel/test/library",
      // "/Users/devongovett/dev/esbuild/require/parcel2/bench/three/",
    ))
    .unwrap(),
  });

  parcel::serve(
    // vec!["/Users/devongovett/dev/esbuild/require/parcel2/bench/three/entry.parcel2.js".into()],
    // vec!["/Users/devongovett/dev/parcel/test/index.html".into()],
    vec!["/Users/devongovett/dev/parcel/test/library".into()],
    options,
  );
}
