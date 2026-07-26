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

fn plugin_config() -> Option<&'static PathBuf> {
  static CONFIG: OnceLock<Option<PathBuf>> = OnceLock::new();
  CONFIG
    .get_or_init(|| {
      let plugin_path = build_go_plugin()?;
      let tmp = std::env::temp_dir().join("parcel-go-custom-content-test");
      let parcelrc_path = tmp.join("native-plugin.parcelrc");
      let parcelrc = format!(
        r#"{{"extends":"@parcel/config-default","transformers":{{"*.upper":[{{"plugin":"@parcel/transformer-native","config":{{"lib":"{}"}}}}],"*.upper.js":[{{"plugin":"@parcel/transformer-native","config":{{"lib":"{}"}}}}]}}}}"#,
        plugin_path.display(),
        plugin_path.display(),
      );
      std::fs::write(&parcelrc_path, &parcelrc).expect("write parcelrc");
      Some(parcelrc_path)
    })
    .as_ref()
}

fn build_fixture(
  entry: &str,
  output_fs: Arc<OverlayFileSystem>,
) -> Option<Result<parcel_core::BundleGraph<'static>, DiagnosticList>> {
  let fixture_dir =
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/custom-content-plugin");
  Some(parcel::build(
    &vec![entry.into()],
    BuildOptions {
      cwd: PathId::new(&fixture_dir),
      config: Some(plugin_config()?.to_str().unwrap().to_owned()),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs,
      mode: parcel_core::BuildMode::Development,
      optimize: None,
      env: Default::default(),
      log_level: LogLevel::Verbose,
      source_map: Some(Default::default()),
      dist_dir: None,
      public_url: Default::default(),
    },
  ))
}

#[test]
fn test_go_custom_content_transformer() {
  let output_fs = Arc::new(OverlayFileSystem::new());
  let Some(result) = build_fixture("index.js", output_fs.clone()) else {
    eprintln!("Go not available – skipping native custom content plugin test");
    return;
  };
  let bundle_graph = result.unwrap_or_else(|e| panic!("parcel build failed: {:?}", e));

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

fn assert_build_diagnostic(entry: &str, expected: &str) {
  let Some(result) = build_fixture(entry, Arc::new(OverlayFileSystem::new())) else {
    eprintln!("Go not available – skipping panic recovery test");
    return;
  };
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
fn go_transform_panic_becomes_diagnostic() {
  assert_build_diagnostic(
    "panic-transform.js",
    "plugin panicked in transform: example transform panic",
  );
}

#[test]
fn go_custom_content_read_panic_becomes_diagnostic() {
  assert_build_diagnostic(
    "panic-read.js",
    "plugin panicked in custom content read: example custom content read panic",
  );
}

#[test]
fn go_custom_content_package_panic_becomes_diagnostic() {
  assert_build_diagnostic(
    "panic-package.js",
    "plugin panicked in custom content package: example custom content package panic",
  );
}
