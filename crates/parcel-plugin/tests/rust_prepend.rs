mod common;

use std::path::{Path, PathBuf};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

const LIB_PREFIX: &str = std::env::consts::DLL_PREFIX;

/// Compiles the Rust prepend-transformer example into a cdylib and returns its
/// path. Uses an isolated `--target-dir` so this subprocess does not contend on
/// the Cargo lock held by the parent test runner.
fn build_rust_plugin() -> PathBuf {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_manifest =
    manifest_dir.join("../../plugin-rs/examples/prepend-transformer/Cargo.toml");
  let target_dir = std::env::temp_dir()
    .join("parcel-rust-prepend-test")
    .join("target");

  let result = std::process::Command::new(&cargo)
    .args([
      "build",
      "--manifest-path",
      plugin_manifest.to_str().unwrap(),
      "--target-dir",
      target_dir.to_str().unwrap(),
    ])
    .output()
    .expect("spawn cargo build");

  assert!(
    result.status.success(),
    "cargo build failed:\nstdout: {}\nstderr: {}",
    String::from_utf8_lossy(&result.stdout),
    String::from_utf8_lossy(&result.stderr),
  );

  target_dir
    .join("debug")
    .join(format!("{LIB_PREFIX}prepend_transformer_rs.{}", LIB_EXT))
}

#[test]
fn rust_transformer_reads_the_input_source_map() {
  common::assert_prepend_keeps_input_map("rust", &build_rust_plugin());
}
