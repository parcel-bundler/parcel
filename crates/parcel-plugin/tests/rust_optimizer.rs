use std::{path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

fn build_rust_optimizer_plugin() -> std::path::PathBuf {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_manifest = manifest_dir.join("../../plugin-rs/examples/custom-optimizer/Cargo.toml");
  let target_dir = std::env::temp_dir()
    .join("parcel-rust-optimizer-test")
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
    .join(format!("libcustom_optimizer_rs.{}", LIB_EXT))
}

#[test]
fn test_rust_optimizer_plugin() {
  let plugin_path = build_rust_optimizer_plugin();
  assert!(
    plugin_path.exists(),
    "built plugin not found at {:?}",
    plugin_path
  );

  let tmp = std::env::temp_dir().join("parcel-rust-optimizer-test");
  let parcelrc_path = tmp.join("rust-optimizer.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","optimizers":{{"*.css":["./target/debug/libcustom_optimizer_rs.{}"]}}}}"#,
    LIB_EXT
  );
  std::fs::write(&parcelrc_path, parcelrc).expect("write parcelrc");

  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-optimizer");
  let output_fs = Arc::new(OverlayFileSystem::new());
  let bundle_graph = parcel::build(
    &vec!["index.css".into()],
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
      hmr: None,
    },
  )
  .unwrap_or_else(|error| panic!("parcel build failed: {:?}", error));

  let css_bundle = bundle_graph
    .bundles
    .iter()
    .find(|bundle| bundle.ty == parcel_core::AssetType::Css)
    .expect("no CSS bundle in output");
  let content = output_fs
    .read_to_string(css_bundle.dist_path())
    .expect("read optimized bundle");
  assert!(content.contains("/* optimized by Rust:"), "got:\n{content}");
  assert!(content.contains("type=css map=true"), "got:\n{content}");
  assert!(
    output_fs
      .read(css_bundle.dist_path().add_extension("map"))
      .is_ok(),
    "optimizer did not preserve the source map"
  );
}
