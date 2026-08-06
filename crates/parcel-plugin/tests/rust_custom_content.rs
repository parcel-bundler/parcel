use std::{
  path::{Path, PathBuf},
  sync::{Arc, OnceLock},
};

use parcel_core::{
  BuildOptions, DiagnosticList, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId,
};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

fn build_rust_plugin() -> std::path::PathBuf {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_manifest =
    manifest_dir.join("../../plugin-rs/examples/custom-content-transformer/Cargo.toml");
  let target_dir = std::env::temp_dir()
    .join("parcel-rust-custom-content-test")
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
    .join(format!("libcustom_content_transformer_rs.{}", LIB_EXT))
}

fn plugin_config() -> &'static PathBuf {
  static CONFIG: OnceLock<PathBuf> = OnceLock::new();
  CONFIG.get_or_init(|| {
    let plugin_path = build_rust_plugin();
    assert!(
      plugin_path.exists(),
      "built plugin not found at {:?}",
      plugin_path
    );

    let tmp = std::env::temp_dir().join("parcel-rust-custom-content-test");
    std::fs::create_dir_all(&tmp).expect("create tmp dir");
    let parcelrc_path = tmp.join("native-plugin.parcelrc");
    let parcelrc = format!(
      r#"{{"extends":"@parcel/config-default","transformers":{{"*.upper":["./target/debug/libcustom_content_transformer_rs.{}"],"*.upper.js":["./target/debug/libcustom_content_transformer_rs.{}"]}}}}"#,
      LIB_EXT, LIB_EXT,
    );
    std::fs::write(&parcelrc_path, &parcelrc).expect("write parcelrc");
    parcelrc_path
  })
}

fn build_fixture(
  entry: &str,
  output_fs: Arc<OverlayFileSystem>,
) -> Result<parcel_core::BundleGraph<'static>, DiagnosticList> {
  let fixture_dir =
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rust-custom-content-plugin");
  parcel::build(
    &vec![entry.into()],
    BuildOptions {
      cwd: PathId::new(&fixture_dir),
      config: Some(plugin_config().to_str().unwrap().to_owned()),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs,
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
}

#[test]
fn test_rust_custom_content_transformer() {
  let output_fs = Arc::new(OverlayFileSystem::new());
  let bundle_graph = build_fixture("index.js", output_fs.clone())
    .unwrap_or_else(|e| panic!("parcel build failed: {:?}", e));

  let outputs = bundle_graph
    .bundles
    .iter()
    .filter(|bundle| bundle.ty == parcel_core::AssetType::Js && bundle.dist_path.is_some())
    .map(|bundle| {
      output_fs
        .read_to_string(bundle.dist_path())
        .expect("read JS bundle")
    })
    .collect::<Vec<_>>();

  assert!(
    outputs
      .iter()
      .any(|content| content.contains("HELLO FROM CUSTOM RUST CONTENT")),
    "Expected custom package output in one of the JS bundles, got:\n{}",
    outputs.join("\n--- bundle ---\n")
  );
  assert!(
    outputs
      .iter()
      .any(|content| content.contains("// rust-custom-content assets=")),
    "Expected metadata produced through BundleGraph accessors"
  );
}

fn assert_build_diagnostic(entry: &str, expected: &str) {
  let result = build_fixture(entry, Arc::new(OverlayFileSystem::new()));
  let Err(diagnostics) = result else {
    panic!("expected build to fail with {expected:?}");
  };
  assert!(
    diagnostics
      .0
      .iter()
      .any(|diagnostic| diagnostic.message.contains(expected)),
    "Expected diagnostic containing {expected:?}, got: {diagnostics:?}"
  );
}

#[test]
fn custom_content_read_panic_becomes_diagnostic() {
  assert_build_diagnostic(
    "panic-read.js",
    "plugin panicked in custom content read: example custom content read panic",
  );
}

#[test]
fn custom_content_package_panic_becomes_diagnostic() {
  assert_build_diagnostic(
    "panic-package.js",
    "plugin panicked in custom content package: example custom content package panic",
  );
}
