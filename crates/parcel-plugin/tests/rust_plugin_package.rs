//! Loads a native plugin the way it ships on npm: a package whose package.json
//! names the library to load for the host platform, either in a separate
//! per-platform package or by a path inside the plugin itself. Neither form has a
//! JavaScript entry point, so nothing here is reachable through ordinary module
//! resolution.

use std::{
  fs,
  path::{Path, PathBuf},
  sync::{Arc, OnceLock},
};

use parcel_core::{BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId};
use parcel_plugin_abi::manifest::TARGET;

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

const PLUGIN: &str = "@parcel-test/txt-transformer";
const ARTIFACT: &str = "@parcel-test/txt-transformer-native";

/// Compiles the Rust txt-transformer example into a cdylib and returns its path.
///
/// Built once per test binary. Tests run on parallel threads, and letting several
/// of them invoke cargo against the same `--target-dir` means one can copy the
/// library while another rewrites it, producing a truncated file that fails to
/// load.
fn build_rust_plugin() -> &'static Path {
  static LIBRARY: OnceLock<PathBuf> = OnceLock::new();
  LIBRARY.get_or_init(build_rust_plugin_once)
}

/// Uses an isolated `--target-dir` so this subprocess does not contend on the
/// Cargo lock held by the parent test runner.
fn build_rust_plugin_once() -> PathBuf {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_manifest = manifest_dir.join("../../plugin-rs/examples/txt-transformer/Cargo.toml");

  let target_dir = std::env::temp_dir()
    .join("parcel-rust-plugin-test")
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

  let library = target_dir
    .join("debug")
    .join(format!("libtxt_transformer_rs.{LIB_EXT}"));
  assert!(library.exists(), "built plugin not found at {library:?}");
  library
}

/// Creates an empty test root, and returns the directory the plugin package goes in.
fn test_root(name: &str) -> PathBuf {
  let root = std::env::temp_dir().join(name);
  let _ = fs::remove_dir_all(&root);
  fs::create_dir_all(root.join("node_modules").join(PLUGIN)).expect("create node_modules");
  root
}

/// Writes a .parcelrc that routes *.txt through the plugin, named as a bare package
/// specifier with no path and no config pointing at a library.
fn write_parcelrc(root: &Path) -> PathBuf {
  let parcelrc_path = root.join("plugin.parcelrc");
  fs::write(
    &parcelrc_path,
    format!(r#"{{"extends":"@parcel/config-default","transformers":{{"*.txt":["{PLUGIN}"]}}}}"#),
  )
  .expect("write parcelrc");
  parcelrc_path
}

fn write_plugin_package(root: &Path, artifact: &str) {
  fs::write(
    root.join("node_modules").join(PLUGIN).join("package.json"),
    format!(
      r#"{{"name":"{PLUGIN}","version":"1.0.0","parcel":{{"abi":1,"artifacts":{{"{TARGET}":"{artifact}"}}}}}}"#
    ),
  )
  .expect("write plugin package.json");
}

/// Builds the fixture with the given .parcelrc, returning the JS bundle's contents,
/// or the build error rendered for assertion.
fn build_fixture(parcelrc_path: &Path) -> Result<String, String> {
  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-plugin");
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
  .map_err(|e| format!("{e:?}"))?;

  let js_bundle = bundle_graph
    .bundles
    .iter()
    .find(|b| b.ty == parcel_core::AssetType::Js)
    .expect("no JS bundle in output");

  Ok(
    output_fs
      .read_to_string(js_bundle.dist_path())
      .expect("read dist file"),
  )
}

#[test]
fn test_artifact_in_a_platform_package() {
  let library = build_rust_plugin();
  let root = test_root("parcel-rust-plugin-package-test");

  // The artifact is nested under the plugin rather than hoisted to the root, the
  // layout npm produces when a hoisted install would conflict, and the one that
  // only works if the artifact is resolved from the plugin's own directory.
  let artifact_dir = root
    .join("node_modules")
    .join(PLUGIN)
    .join("node_modules")
    .join(ARTIFACT);
  fs::create_dir_all(&artifact_dir).expect("create artifact package");
  fs::copy(&library, artifact_dir.join(format!("plugin.{LIB_EXT}"))).expect("copy library");
  fs::write(
    artifact_dir.join("package.json"),
    format!(
      r#"{{"name":"{ARTIFACT}","version":"1.0.0","parcel":{{"abi":1,"library":"plugin.{LIB_EXT}"}}}}"#
    ),
  )
  .expect("write artifact package.json");

  write_plugin_package(&root, ARTIFACT);

  let content = build_fixture(&write_parcelrc(&root)).expect("build should have succeeded");
  assert!(
    content.contains("Hello from Go!"),
    "expected the plugin to have transformed greeting.txt, got:\n{content}"
  );
}

#[test]
fn test_artifact_by_relative_path() {
  let library = build_rust_plugin();
  let root = test_root("parcel-rust-plugin-relative-test");

  // Everything in one package: the artifact is a path to a library sitting next to
  // the plugin's own package.json.
  let plugin_dir = root.join("node_modules").join(PLUGIN);
  fs::copy(
    &library,
    plugin_dir.join(format!("plugin-{TARGET}.{LIB_EXT}")),
  )
  .expect("copy library");
  write_plugin_package(&root, &format!("./plugin-{TARGET}.{LIB_EXT}"));

  let content = build_fixture(&write_parcelrc(&root)).expect("build should have succeeded");
  assert!(
    content.contains("Hello from Go!"),
    "expected the plugin to have transformed greeting.txt, got:\n{content}"
  );
}

#[test]
fn test_missing_artifact_package_reports_a_useful_error() {
  // Install the plugin, but not the artifact package for this platform - the state
  // npm leaves behind when an optional dependency is skipped.
  let root = test_root("parcel-rust-plugin-missing-package-test");
  write_plugin_package(&root, ARTIFACT);

  let error = build_fixture(&write_parcelrc(&root)).expect_err("build should have failed");
  assert!(
    error.contains(ARTIFACT) && error.contains(TARGET),
    "error should name the missing artifact package and the target, got:\n{error}"
  );
}

#[test]
fn test_missing_artifact_file_reports_a_useful_error() {
  let root = test_root("parcel-rust-plugin-missing-library-test");
  write_plugin_package(&root, "./plugin.dylib");

  let error = build_fixture(&write_parcelrc(&root)).expect_err("build should have failed");
  assert!(
    error.contains("./plugin.dylib") && error.contains("does not exist"),
    "error should name the missing library, got:\n{error}"
  );
}

/// Writes a plugin package whose artifacts point at a package that is not
/// installed, plus a devLibrary pointing at a local build. Only the devLibrary
/// can possibly resolve, which is what makes it visible in the assertion.
fn write_plugin_package_with_dev_library(root: &Path, dev_library: &str) {
  fs::write(
    root.join("node_modules").join(PLUGIN).join("package.json"),
    format!(
      r#"{{"name":"{PLUGIN}","version":"1.0.0","parcel":{{"abi":1,"artifacts":{{"{TARGET}":"{ARTIFACT}"}},"devLibrary":"{dev_library}"}}}}"#
    ),
  )
  .expect("write plugin package.json");
}

/// A locally built library takes precedence over the published artifacts, so a
/// plugin author can iterate without installing anything or editing the artifact
/// map. Publishing strips the key, so it can only ever apply in a working tree.
#[test]
fn test_dev_library_wins_over_artifacts() {
  let library = build_rust_plugin();
  let root = test_root("parcel-rust-plugin-dev-library-test");

  // Deliberately left without an extension: Parcel appends this platform's, so
  // one entry works for everyone on a team regardless of what they build on.
  let plugin_dir = root.join("node_modules").join(PLUGIN);
  fs::create_dir_all(plugin_dir.join("build")).expect("create build dir");
  fs::copy(
    &library,
    plugin_dir.join("build").join(format!("local.{LIB_EXT}")),
  )
  .expect("copy library");
  write_plugin_package_with_dev_library(&root, "./build/local");

  let content = build_fixture(&write_parcelrc(&root)).expect("build should have succeeded");
  assert!(
    content.contains("Hello from Go!"),
    "expected the local build to have transformed greeting.txt, got:\n{content}"
  );
}

/// Falling through to the artifacts here would be the worst outcome available: a
/// stale published binary loads and the author's changes appear to do nothing.
#[test]
fn test_missing_dev_library_reports_a_useful_error() {
  let root = test_root("parcel-rust-plugin-dev-library-missing-test");
  write_plugin_package_with_dev_library(&root, "./build/local");

  let error = build_fixture(&write_parcelrc(&root)).expect_err("build should have failed");
  assert!(
    error.contains("devLibrary") && error.contains("./build/local"),
    "error should name the devLibrary that is missing, got:\n{error}"
  );
  assert!(
    error.contains("Build the plugin first"),
    "error should say what to do about it, got:\n{error}"
  );
}

/// Compiles `source` into a cdylib at `out`, standing in for a plugin library that
/// no SDK in this repository would produce.
fn build_stub_library(source: &str, out: &Path) {
  let source_path = out.with_extension("rs");
  fs::write(&source_path, source).expect("write stub source");
  let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".to_owned());
  let result = std::process::Command::new(rustc)
    .args(["--crate-type", "cdylib", "--edition", "2024", "-o"])
    .arg(out)
    .arg(&source_path)
    .output()
    .expect("spawn rustc");
  assert!(
    result.status.success(),
    "rustc failed:\n{}",
    String::from_utf8_lossy(&result.stderr),
  );
}

/// A library whose `parcel_plugin_init` returns `status` without doing anything.
fn init_stub(status: u8) -> String {
  format!(
    "#[unsafe(no_mangle)] pub extern \"C\" fn parcel_plugin_init(\
     _: *const u8, _: *const u8, _: usize, _: *mut *mut u8, _: *mut u8) -> u8 {{ {status} }}"
  )
}

/// Points the plugin package's devLibrary at `library`, a file inside the plugin's
/// directory, and builds with it.
fn build_with_library(test: &str, write_library: impl FnOnce(&Path)) -> String {
  let root = test_root(test);
  let library = root
    .join("node_modules")
    .join(PLUGIN)
    .join(format!("plugin.{LIB_EXT}"));
  write_library(&library);
  write_plugin_package_with_dev_library(&root, &format!("./plugin.{LIB_EXT}"));
  build_fixture(&write_parcelrc(&root)).expect_err("build should have failed")
}

/// Asserts that a load failure names the plugin and its library, and says to rebuild it.
fn assert_rebuild_error(error: &str, message: &str) {
  assert!(
    error.contains(message),
    "error should say {message:?}, got:\n{error}"
  );
  assert!(
    error.contains(&format!("origin: Some(\"{PLUGIN}\")"))
      && error.contains(&format!("plugin.{LIB_EXT}")),
    "error should name the plugin and its library, got:\n{error}"
  );
  assert!(
    error.contains("Rebuild the plugin against the SDK"),
    "error should say what to do about it, got:\n{error}"
  );
}

/// A plugin rejects a function table it was not built for.
#[test]
fn test_incompatible_library_reports_a_useful_error() {
  let error = build_with_library("parcel-rust-plugin-incompatible-test", |library| {
    build_stub_library(&init_stub(2), library)
  });
  assert_rebuild_error(
    &error,
    "was built for a different version of Parcel's plugin ABI",
  );
}

/// Libraries built before `parcel_plugin_init` returned a status returned their
/// state pointer, which is unlikely to be a status any SDK returns.
#[test]
fn test_unknown_init_status_reports_a_useful_error() {
  let error = build_with_library("parcel-rust-plugin-unknown-status-test", |library| {
    build_stub_library(&init_stub(0x40), library)
  });
  assert_rebuild_error(
    &error,
    "was built for a different version of Parcel's plugin ABI",
  );
}

/// A library configured as a kind of plugin whose entry point it doesn't export
/// fails when it is loaded, rather than at its first call.
#[test]
fn test_library_without_the_configured_entry_point_reports_a_useful_error() {
  let error = build_with_library("parcel-rust-plugin-wrong-kind-test", |library| {
    build_stub_library(&init_stub(0), library)
  });
  assert!(
    error.contains(&format!("{PLUGIN} is configured as a transformer but"))
      && error.contains("does not export parcel_plugin_transform()"),
    "error should say which entry point is missing, got:\n{error}"
  );
  assert!(
    error.contains(&format!("origin: Some(\"{PLUGIN}\")")),
    "error should name the plugin, got:\n{error}"
  );
}

#[test]
fn test_library_without_init_reports_a_useful_error() {
  let error = build_with_library("parcel-rust-plugin-no-init-test", |library| {
    build_stub_library(
      "#[unsafe(no_mangle)] pub extern \"C\" fn other() {}",
      library,
    )
  });
  assert_rebuild_error(&error, "does not export a parcel_plugin_init function");
}

#[test]
fn test_unloadable_library_reports_a_useful_error() {
  let error = build_with_library("parcel-rust-plugin-unloadable-test", |library| {
    fs::write(library, "not a library").expect("write library")
  });
  assert_rebuild_error(&error, "Could not load");
}

/// The ABI a published plugin declares is checked before its library is opened.
#[test]
fn test_mismatched_abi_in_package_json_reports_a_useful_error() {
  let root = test_root("parcel-rust-plugin-abi-mismatch-test");
  fs::write(
    root.join("node_modules").join(PLUGIN).join("package.json"),
    format!(
      r#"{{"name":"{PLUGIN}","version":"1.0.0","parcel":{{"abi":0,"artifacts":{{"{TARGET}":"{ARTIFACT}"}}}}}}"#
    ),
  )
  .expect("write plugin package.json");

  let error = build_fixture(&write_parcelrc(&root)).expect_err("build should have failed");
  assert!(
    error.contains(&format!("{PLUGIN} was built for ABI 0")),
    "error should name the plugin and its ABI, got:\n{error}"
  );
  assert!(
    error.contains("origin: Some(\"@parcel/core\")") && error.contains("package.json"),
    "error should point at the plugin's package.json, got:\n{error}"
  );
  assert!(
    error.contains("Install a version of"),
    "error should say what to do about it, got:\n{error}"
  );
}
