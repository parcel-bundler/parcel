use std::{path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

fn build_rust_namer_plugin() -> std::path::PathBuf {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_manifest = manifest_dir.join("../../plugin-rs/examples/custom-namer/Cargo.toml");
  let target_dir = std::env::temp_dir()
    .join("parcel-rust-namer-test")
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
    .join(format!("libcustom_namer_rs.{}", LIB_EXT))
}

#[test]
fn test_rust_namer_plugin() {
  let plugin_path = build_rust_namer_plugin();
  assert!(
    plugin_path.exists(),
    "built plugin not found at {:?}",
    plugin_path
  );

  let tmp = std::env::temp_dir().join("parcel-rust-namer-test");
  let parcelrc_path = tmp.join("rust-namer.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","namers":["./target/debug/libcustom_namer_rs.{}", "..."]}}"#,
    LIB_EXT
  );
  std::fs::write(&parcelrc_path, parcelrc).expect("write parcelrc");

  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-namer");
  let output_fs = Arc::new(OverlayFileSystem::new());
  let bundle_graph = parcel::build(
    &vec!["index.js".into()],
    BuildOptions {
      cwd: PathId::new(&fixture_dir),
      config: Some(parcelrc_path.to_string_lossy().into_owned()),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: output_fs.clone(),
      mode: parcel_core::BuildMode::Development,
      optimize: None,
      env: Default::default(),
      log_level: LogLevel::Verbose,
      source_map: Some(Default::default()),
      dist_dir: None,
      public_url: Default::default(),
    },
  )
  .unwrap_or_else(|error| panic!("parcel build failed: {:?}", error));

  let js_bundle = bundle_graph
    .bundles
    .iter()
    .find(|bundle| bundle.ty == parcel_core::AssetType::Js)
    .expect("no JS bundle in output");
  assert_eq!(js_bundle.name(), "rust-index.js");
  assert!(
    output_fs.read_to_string(js_bundle.dist_path()).is_ok(),
    "named bundle was not written"
  );
}
