use std::{collections::HashMap, path::Path, sync::Arc};

use parcel_core::{BuildOptions, OsFileSystem, SourceUrl};

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
  let options = BuildOptions {
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: Arc::new(OsFileSystem {}),
    log_level: parcel_core::LogLevel::Verbose,
    mode,
  };

  parcel::serve(
    // vec!["/Users/devongovett/dev/esbuild/require/parcel2/bench/three/entry.parcel2.js".into()],
    // vec!["/Users/devongovett/dev/parcel/test/index.html".into()],
    vec!["/Users/devongovett/dev/parcel/test/library".into()],
    options,
  );
}
