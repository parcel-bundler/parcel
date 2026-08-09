use std::{path::Path, sync::Arc};

use parcel_core::{
  BuildOptions, Diagnostic, DiagnosticList, LogEvent, LogLevel, LogMessage, OsFileSystem,
  OverlayFileSystem, ParcelOptions, PathId, Reporter, ReporterEvent,
};
use parcel_plugin_abi::CPlugin;

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

fn build_example(name: &str, lib: &str, target_dir: &Path) -> std::path::PathBuf {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_manifest = manifest_dir.join(format!("../../plugin-rs/examples/{name}/Cargo.toml"));

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

  target_dir.join("debug").join(format!("lib{lib}.{LIB_EXT}"))
}

/// Calls the plugin's `parcel_plugin_report` directly, so each event kind is
/// exercised without needing a build that produces it.
#[test]
fn test_rust_reporter_receives_every_event_kind() {
  let target_dir = std::env::temp_dir()
    .join("parcel-rust-reporter-test")
    .join("target");
  let plugin_path = build_example("custom-reporter", "custom_reporter_rs", &target_dir);
  assert!(
    plugin_path.exists(),
    "built plugin not found at {plugin_path:?}"
  );

  let plugin = CPlugin::new(PathId::new(&plugin_path), None).expect("load plugin");
  let options = ParcelOptions::default();

  plugin
    .report(&ReporterEvent::BuildStart, &options)
    .expect("buildStart");

  let diagnostics = DiagnosticList(vec![Diagnostic {
    message: "it did not work".into(),
    origin: Some("@acme/plugin".into()),
    hints: vec!["try something else".into()],
    ..Diagnostic::from_message(String::new())
  }]);
  plugin
    .report(
      &ReporterEvent::BuildFailure {
        diagnostics: &diagnostics,
      },
      &options,
    )
    .expect("buildFailure");

  plugin
    .report(
      &ReporterEvent::Log(LogEvent {
        level: LogLevel::Warn,
        message: LogMessage::Text("a message"),
      }),
      &options,
    )
    .expect("log with a message");

  plugin
    .report(
      &ReporterEvent::Log(LogEvent {
        level: LogLevel::Info,
        message: LogMessage::Diagnostics(&diagnostics.0),
      }),
      &options,
    )
    .expect("log with diagnostics");
}

/// A plugin configured as a reporter that does not act as one must say so
/// rather than silently doing nothing.
///
/// `register_plugin!` exports every entry point regardless of which methods the
/// plugin overrides, so this reaches the trait's default `report` and comes back
/// as its diagnostic — not as a missing symbol. Only a plugin built without the
/// Rust SDK can fail the symbol lookup.
#[test]
fn test_a_plugin_that_is_not_a_reporter_says_so() {
  let target_dir = std::env::temp_dir()
    .join("parcel-rust-namer-test")
    .join("target");
  let plugin_path = build_example("custom-namer", "custom_namer_rs", &target_dir);

  let plugin = CPlugin::new(PathId::new(&plugin_path), None).expect("load plugin");
  let error = plugin
    .report(&ReporterEvent::BuildStart, &ParcelOptions::default())
    .expect_err("a namer is not a reporter");

  assert!(
    error.0[0].message.contains("report not implemented"),
    "got: {}",
    error.0[0].message
  );
}

/// The whole path: a reporter named in a `.parcelrc`, loaded by the factory and
/// driven by the build's own events.
#[test]
fn test_rust_reporter_plugin_in_a_build() {
  let tmp = std::env::temp_dir().join("parcel-rust-reporter-test");
  let target_dir = tmp.join("target");
  build_example("custom-reporter", "custom_reporter_rs", &target_dir);

  let parcelrc_path = tmp.join("rust-reporter.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","reporters":["./target/debug/libcustom_reporter_rs.{LIB_EXT}"]}}"#
  );
  std::fs::write(&parcelrc_path, parcelrc).expect("write parcelrc");

  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-namer");
  let output_fs = Arc::new(OverlayFileSystem::new());
  parcel::build(
    &vec!["index.js".into()],
    BuildOptions {
      cwd: PathId::new(&fixture_dir),
      config: Some(parcelrc_path.to_string_lossy().into_owned()),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: output_fs.clone(),
      mode: parcel_core::BuildMode::Development,
      optimize: None,
      env: Default::default(),
      log_level: parcel_core::LogLevel::Verbose,
      source_map: Some(Default::default()),
      dist_dir: None,
      public_url: Default::default(),
      hmr: None,
    },
  )
  .unwrap_or_else(|error| panic!("parcel build failed: {error:?}"));
}
