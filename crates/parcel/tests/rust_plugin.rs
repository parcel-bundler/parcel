use std::{path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

/// Compiles the Rust txt-transformer example into a cdylib and returns its
/// path.  Uses an isolated `--target-dir` so this subprocess does not
/// contend on the Cargo lock held by the parent test runner.
fn build_rust_plugin() -> std::path::PathBuf {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_manifest = manifest_dir.join("../../plugin-rs/examples/txt-transformer/Cargo.toml");

  let target_dir = std::env::temp_dir()
    .join("parcel-rust-plugin-test")
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
    .join(format!("libtxt_transformer_rs.{}", LIB_EXT))
}

#[test]
fn test_rust_transformer_plugin() {
  let plugin_path = build_rust_plugin();

  assert!(
    plugin_path.exists(),
    "built plugin not found at {:?}",
    plugin_path
  );

  // Write a temporary .parcelrc that routes *.txt through the Rust plugin.
  let tmp = std::env::temp_dir().join("parcel-rust-plugin-test");
  let parcelrc_path = tmp.join("rust-plugin.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","transformers":{{"*.txt":[{{"plugin":"@parcel/transformer-native","config":{{"lib":"{}"}}}}]}}}}"#,
    plugin_path.display()
  );
  std::fs::write(&parcelrc_path, &parcelrc).expect("write parcelrc");

  // Reuse the same fixture as the Go native plugin test.
  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-plugin");
  let output_fs = Arc::new(OverlayFileSystem::new());

  let bundle_graph = parcel::build(
    &vec!["index.js".into()],
    BuildOptions {
      cwd: PathId::new(&fixture_dir),
      config: Some(parcelrc_path.to_str().unwrap().to_owned()),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: output_fs.clone(),
      mode: parcel_core::BuildMode::Development,
      env: Default::default(),
      log_level: LogLevel::Verbose,
    },
  )
  .unwrap_or_else(|e| panic!("parcel build failed: {:?}", e));

  let js_bundle = bundle_graph
    .bundles
    .iter()
    .find(|b| b.ty == parcel_core::AssetType::Js)
    .expect("no JS bundle in output");

  let dist_path = js_bundle.dist_path(&bundle_graph.project_root);
  let content = output_fs.read_to_string(dist_path).expect("read dist file");

  assert!(
    content.contains("Hello from Go!"),
    "Expected bundle to contain 'Hello from Go!', got:\n{}",
    content
  );
}
