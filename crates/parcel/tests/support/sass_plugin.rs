use std::{
  path::{Path, PathBuf},
  process::Command,
  sync::OnceLock,
};

/// Builds the Sass transformer, a native plugin loaded by the Sass tests at run time, and returns
/// the path of its library.
///
/// Cargo copies the library of a package it is asked to build into target/debug. Where it puts a
/// cdylib dev-dependency instead is not stable: Cargo 1.100 moved it from target/debug/deps, next
/// to the test binaries, into a directory of its own.
pub fn sass_plugin() -> &'static Path {
  static LIBRARY: OnceLock<PathBuf> = OnceLock::new();
  LIBRARY.get_or_init(|| {
    let output = Command::new(env!("CARGO"))
      .args(["build", "-p", "parcel-transformer-sass"])
      .output()
      .expect("failed to run cargo");
    assert!(
      output.status.success(),
      "building parcel-transformer-sass failed:\n{}",
      String::from_utf8_lossy(&output.stderr)
    );
    Path::new(env!("CARGO_MANIFEST_DIR"))
      .ancestors()
      .nth(2)
      .unwrap()
      .join("target/debug")
      .join(format!(
        "{}parcel_transformer_sass.{}",
        std::env::consts::DLL_PREFIX,
        std::env::consts::DLL_EXTENSION
      ))
  })
}
