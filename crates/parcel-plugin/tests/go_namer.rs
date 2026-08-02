use std::{path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

fn build_go_namer_plugin() -> Option<std::path::PathBuf> {
  let check = std::process::Command::new("go")
    .arg("version")
    .output()
    .ok()?;
  if !check.status.success() {
    return None;
  }

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_src = manifest_dir.join("../../plugin-go/examples/custom-namer");
  let tmp = std::env::temp_dir().join("parcel-go-namer-test");
  std::fs::create_dir_all(&tmp).expect("create temp directory");
  let lib_path = tmp.join(format!("custom-namer.{}", LIB_EXT));
  let result = std::process::Command::new("go")
    .args([
      "build",
      "-buildmode=c-shared",
      "-o",
      lib_path.to_str().unwrap(),
      ".",
    ])
    .current_dir(plugin_src)
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
fn test_go_namer_plugin() {
  let Some(plugin_path) = build_go_namer_plugin() else {
    eprintln!("Go not available – skipping native namer test");
    return;
  };

  let tmp = std::env::temp_dir().join("parcel-go-namer-test");
  let parcelrc_path = tmp.join("go-namer.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","namers":["./custom-namer.{}", "..."]}}"#,
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
  assert_eq!(js_bundle.name(), "go-index.js");
  assert!(
    output_fs.read_to_string(js_bundle.dist_path()).is_ok(),
    "named bundle was not written"
  );
}
