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

/// Builds the Go example plugin, or returns `None` when Go is not installed.
fn build_go_reporter_plugin() -> Option<std::path::PathBuf> {
  let check = std::process::Command::new("go")
    .arg("version")
    .output()
    .ok()?;
  if !check.status.success() {
    return None;
  }

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_src = manifest_dir.join("../../plugin-go/examples/custom-reporter");
  let tmp = std::env::temp_dir().join("parcel-go-reporter-test");
  std::fs::create_dir_all(&tmp).expect("create temp directory");
  let lib_path = tmp.join(format!("custom-reporter.{}", LIB_EXT));
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

/// Calls the plugin's `parcel_plugin_report` directly, so each event kind is
/// exercised without needing a build that produces it.
#[test]
fn test_go_reporter_receives_every_event_kind() {
  let Some(plugin_path) = build_go_reporter_plugin() else {
    eprintln!("Go not available – skipping native reporter test");
    return;
  };

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

/// A Go plugin that is not a reporter reaches [`parcel.DefaultPlugin`]'s
/// `Report`, which reports that rather than doing nothing.
#[test]
fn test_a_go_plugin_that_is_not_a_reporter_says_so() {
  let Some(_) = build_go_reporter_plugin() else {
    eprintln!("Go not available – skipping native reporter test");
    return;
  };

  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let tmp = std::env::temp_dir().join("parcel-go-reporter-test");
  let lib_path = tmp.join(format!("custom-namer.{LIB_EXT}"));
  let result = std::process::Command::new("go")
    .args([
      "build",
      "-buildmode=c-shared",
      "-o",
      lib_path.to_str().unwrap(),
      ".",
    ])
    .current_dir(manifest_dir.join("../../plugin-go/examples/custom-namer"))
    .output()
    .expect("spawn go build");
  assert!(result.status.success(), "go build failed");

  let plugin = CPlugin::new(PathId::new(&lib_path), None).expect("load plugin");
  let error = plugin
    .report(&ReporterEvent::BuildStart, &ParcelOptions::default())
    .expect_err("a namer is not a reporter");

  assert!(
    error.0[0].message.contains("report not implemented"),
    "got: {}",
    error.0[0].message
  );
}

/// The whole path: a Go reporter named in a `.parcelrc`, loaded by the factory
/// and driven by the build's own events.
#[test]
fn test_go_reporter_plugin_in_a_build() {
  let Some(_) = build_go_reporter_plugin() else {
    eprintln!("Go not available – skipping native reporter test");
    return;
  };

  let tmp = std::env::temp_dir().join("parcel-go-reporter-test");
  let parcelrc_path = tmp.join("go-reporter.parcelrc");
  let parcelrc = format!(
    r#"{{"extends":"@parcel/config-default","reporters":["./custom-reporter.{LIB_EXT}"]}}"#
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
