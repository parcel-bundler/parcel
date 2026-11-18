mod common;

use std::{path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

/// Builds the Go custom-resolver plugin from source and returns the path to the
/// compiled shared library. Returns `None` if Go is not installed.
/// Built once, since the tests run concurrently and would otherwise write the
/// same library at the same time.
fn build_go_resolver_plugin() -> Option<std::path::PathBuf> {
  static BUILT: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
  BUILT.get_or_init(build).clone()
}

fn build() -> Option<std::path::PathBuf> {
  if !common::go_available() {
    return None;
  }

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_src = manifest_dir.join("../../plugin-go/examples/custom-resolver");

  let tmp = std::env::temp_dir().join("parcel-go-resolver-test");
  std::fs::create_dir_all(&tmp).expect("create tmp dir");
  let lib_path = tmp.join(format!("custom-resolver.{}", LIB_EXT));

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
fn test_go_resolver_plugin() {
  let Some(_) = build_go_resolver_plugin() else {
    eprintln!("Go not available – skipping native resolver test");
    return;
  };

  let tmp = std::env::temp_dir().join("parcel-go-resolver-test");
  let parcelrc_path = tmp.join("native-resolver.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","resolvers":["./custom-resolver.{}", "..."]}}"#,
    LIB_EXT
  );
  std::fs::write(&parcelrc_path, &parcelrc).expect("write parcelrc");

  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-resolver");
  let output_fs = Arc::new(OverlayFileSystem::new());

  let bundle_graph = parcel::build(
    &vec!["index.js".into()],
    BuildOptions {
      cwd: PathId::new(&fixture_dir),
      config: Some(parcelrc_path.to_str().unwrap().to_owned()),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: output_fs.clone(),
      mode: parcel_core::BuildMode::Development,
      optimize: None,
      content_hash: None,
      env: Default::default(),
      log_level: LogLevel::Verbose,
      source_map: Some(Default::default()),
      dist_dir: None,
      public_url: Default::default(),
      hmr: None,
      reporters: Vec::new(),
    },
  )
  .unwrap_or_else(|e| panic!("parcel build failed: {:?}", e));

  let js_bundle = bundle_graph
    .bundles
    .iter()
    .find(|b| b.ty == parcel_core::AssetType::Js)
    .expect("no JS bundle in output");

  let dist_path = js_bundle.dist_path();
  let content = output_fs.read_to_string(dist_path).expect("read dist file");

  assert!(
    content.contains("Hello from native resolver!"),
    "Expected bundle to contain 'Hello from native resolver!', got:\n{}",
    content
  );
}

/// A Go plugin fails with a diagnostic that has several code frames,
/// highlights and hints.
#[test]
fn test_go_resolver_fails_with_several_code_frames() {
  let Some(plugin_path) = build_go_resolver_plugin() else {
    eprintln!("Go not available – skipping Go resolver test");
    return;
  };
  common::assert_resolver_fails_with_several_code_frames(&plugin_path);
}

/// A Go plugin logs a warning with several code frames without failing.
#[test]
fn test_go_resolver_logs_a_warning_with_several_code_frames() {
  let Some(plugin_path) = build_go_resolver_plugin() else {
    eprintln!("Go not available – skipping Go resolver test");
    return;
  };
  common::assert_resolver_logs_a_warning_with_several_code_frames(&plugin_path);
}
