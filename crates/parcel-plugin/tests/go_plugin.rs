use std::{path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

/// Builds the Go txt-transformer plugin from source and returns the path to the
/// compiled shared library. Returns `None` if Go is not installed.
fn build_go_plugin() -> Option<std::path::PathBuf> {
  // Verify go is available.
  let check = std::process::Command::new("go")
    .arg("version")
    .output()
    .ok()?;
  if !check.status.success() {
    return None;
  }

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_src = manifest_dir.join("../../plugin-go/examples/txt-transformer");

  let tmp = std::env::temp_dir().join("parcel-go-test");
  std::fs::create_dir_all(&tmp).expect("create tmp dir");
  let lib_path = tmp.join(format!("txt-transformer.{}", LIB_EXT));

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
fn test_go_transformer_plugin() {
  let Some(plugin_path) = build_go_plugin() else {
    eprintln!("Go not available – skipping native plugin test");
    return;
  };

  // Write a temporary .parcelrc that routes *.txt through the Go plugin.
  let tmp = std::env::temp_dir().join("parcel-go-test");
  let parcelrc_path = tmp.join("native-plugin.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","transformers":{{"*.txt":[{{"plugin":"@parcel/transformer-native","config":{{"lib":"{}"}}}}]}}}}"#,
    plugin_path.display()
  );
  std::fs::write(&parcelrc_path, &parcelrc).expect("write parcelrc");

  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-plugin");
  let output_fs = Arc::new(OverlayFileSystem::new());

  let bundle_graph = parcel::build(
    &vec!["index.js".into()],
    BuildOptions {
      cwd: PathId::new(&fixture_dir),
      // Absolute path works because PathBuf::join replaces the base for absolute paths.
      config: Some(parcelrc_path.to_str().unwrap().to_owned()),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: output_fs.clone(),
      mode: parcel_core::BuildMode::Development,
      minify: None,
      env: Default::default(),
      log_level: LogLevel::Verbose,
    },
  )
  .unwrap_or_else(|e| panic!("parcel build failed: {:?}", e));

  // Find the JS entry bundle and verify the Go transformer's output is present.
  let js_bundle = bundle_graph
    .bundles
    .iter()
    .find(|b| b.ty == parcel_core::AssetType::Js)
    .expect("no JS bundle in output");

  let dist_path = js_bundle.dist_path();
  let content = output_fs.read_to_string(dist_path).expect("read dist file");

  assert!(
    content.contains("Hello from Go!"),
    "Expected bundle to contain 'Hello from Go!', got:\n{}",
    content
  );
}
