use std::{path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

fn build_go_plugin() -> Option<std::path::PathBuf> {
  let check = std::process::Command::new("go")
    .arg("version")
    .output()
    .ok()?;
  if !check.status.success() {
    return None;
  }

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_src = manifest_dir.join("../../plugin-go/examples/custom-content-transformer");
  let tmp = std::env::temp_dir().join("parcel-go-custom-content-test");
  std::fs::create_dir_all(&tmp).expect("create tmp dir");
  let lib_path = tmp.join(format!("custom-content-transformer.{}", LIB_EXT));

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
fn test_go_custom_content_transformer() {
  let Some(plugin_path) = build_go_plugin() else {
    eprintln!("Go not available – skipping native custom content plugin test");
    return;
  };

  let tmp = std::env::temp_dir().join("parcel-go-custom-content-test");
  let parcelrc_path = tmp.join("native-plugin.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","transformers":{{"*.upper.js":[{{"plugin":"@parcel/transformer-native","config":{{"lib":"{}"}}}}]}}}}"#,
    plugin_path.display()
  );
  std::fs::write(&parcelrc_path, &parcelrc).expect("write parcelrc");

  let fixture_dir =
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/custom-content-plugin");
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
      env: Default::default(),
      log_level: LogLevel::Verbose,
      source_map: Some(Default::default()),
      dist_dir: None,
      public_url: Default::default(),
    },
  )
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
      .any(|content| content.contains("HELLO FROM CUSTOM GO CONTENT")),
    "Expected custom package output in one of the JS bundles, got:\n{}",
    outputs.join("\n--- bundle ---\n")
  );
  assert!(
    outputs
      .iter()
      .any(|content| content.contains("// custom-content assets=")),
    "Expected metadata produced through BundleGraph accessors"
  );
}
