use std::{path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

fn build_go_optimizer_plugin() -> Option<std::path::PathBuf> {
  let check = std::process::Command::new("go")
    .arg("version")
    .output()
    .ok()?;
  if !check.status.success() {
    return None;
  }

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_src = manifest_dir.join("../../plugin-go/examples/custom-optimizer");
  let tmp = std::env::temp_dir().join("parcel-go-optimizer-test");
  std::fs::create_dir_all(&tmp).expect("create temp directory");
  let lib_path = tmp.join(format!("custom-optimizer.{}", LIB_EXT));
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
fn test_go_optimizer_plugin() {
  let Some(plugin_path) = build_go_optimizer_plugin() else {
    eprintln!("Go not available – skipping native optimizer test");
    return;
  };

  let tmp = std::env::temp_dir().join("parcel-go-optimizer-test");
  let parcelrc_path = tmp.join("go-optimizer.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","optimizers":{{"*.css":[{{"plugin":"@parcel/optimizer-native","config":{{"lib":"{}"}}}}]}}}}"#,
    plugin_path.display()
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
  assert!(content.contains("/* optimized by Go:"), "got:\n{content}");
  assert!(content.contains("type=css map=true"), "got:\n{content}");
  assert!(
    output_fs
      .read(css_bundle.dist_path().add_extension("map"))
      .is_ok(),
    "optimizer did not preserve the source map"
  );
}
