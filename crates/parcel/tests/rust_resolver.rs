use std::{path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

/// Compiles the Rust custom-resolver example into a cdylib and returns its path.
fn build_rust_resolver_plugin() -> std::path::PathBuf {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_manifest = manifest_dir.join("../../plugin-rs/examples/custom-resolver/Cargo.toml");

  let target_dir = std::env::temp_dir()
    .join("parcel-rust-resolver-test")
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
    .join(format!("libcustom_resolver_rs.{}", LIB_EXT))
}

#[test]
fn test_rust_resolver_plugin() {
  let plugin_path = build_rust_resolver_plugin();

  assert!(
    plugin_path.exists(),
    "built plugin not found at {:?}",
    plugin_path
  );

  let tmp = std::env::temp_dir().join("parcel-rust-resolver-test");
  let parcelrc_path = tmp.join("rust-resolver.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","resolvers":[{{"plugin":"@parcel/resolver-native","config":{{"lib":"{}"}}}}, "..."]}}"#,
    plugin_path.display()
  );
  std::fs::write(&parcelrc_path, &parcelrc).expect("write parcelrc");

  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-resolver");
  let output_fs = Arc::new(OverlayFileSystem::new());

  let bundle_graph = parcel::build(
    &vec!["index.js".into()],
    BuildOptions {
      cwd: fixture_dir.clone(),
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
    content.contains("Hello from native resolver!"),
    "Expected bundle to contain 'Hello from native resolver!', got:\n{}",
    content
  );
}
