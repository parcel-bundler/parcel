mod common;

use std::path::{Path, PathBuf};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

/// Builds the Go prepend-transformer plugin from source and returns the path to
/// the compiled shared library. Returns `None` if Go is not installed.
fn build_go_plugin() -> Option<PathBuf> {
  let check = std::process::Command::new("go")
    .arg("version")
    .output()
    .ok()?;
  if !check.status.success() {
    return None;
  }

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_src = manifest_dir.join("../../plugin-go/examples/prepend-transformer");

  let tmp = std::env::temp_dir().join("parcel-go-prepend-test");
  std::fs::create_dir_all(&tmp).expect("create tmp dir");
  let lib_path = tmp.join(format!("prepend-transformer.{}", LIB_EXT));

  let result = std::process::Command::new("go")
    .args([
      "build",
      "-buildmode=c-shared",
      "-o",
      lib_path.to_str().unwrap(),
      ".",
    ])
    .current_dir(&plugin_src)
    .output()
    .expect("spawn go build");

  assert!(
    result.status.success(),
    "go build failed:\nstdout: {}\nstderr: {}",
    String::from_utf8_lossy(&result.stdout),
    String::from_utf8_lossy(&result.stderr),
  );

  Some(lib_path)
}

#[test]
fn go_transformer_reads_the_input_source_map() {
  let Some(plugin_path) = build_go_plugin() else {
    eprintln!("Go not available – skipping native plugin test");
    return;
  };
  common::assert_prepend_keeps_input_map("go", &plugin_path);
}
