//! Builds the Swift SDK's example plugins and runs them in real builds.
//!
//! Skipped unless Swift 6.2 or later is installed.

mod common;

use std::{
  path::{Path, PathBuf},
  sync::{Arc, OnceLock},
};

use parcel_core::{
  BuildOptions, Diagnostic, DiagnosticList, FileSystem, LogEvent, LogLevel, LogMessage,
  OsFileSystem, OverlayFileSystem, ParcelOptions, PathId, Reporter, ReporterEvent,
};
use parcel_plugin_abi::CPlugin;

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

const EXAMPLES: &[&str] = &[
  "TxtTransformer",
  "CustomResolver",
  "CustomNamer",
  "CustomOptimizer",
  "CustomReporter",
  "CustomContentTransformer",
  "AsyncPlugin",
  "PrependTransformer",
];

/// Builds every example once, and copies the libraries into a temporary
/// directory as `<Name>.<ext>`, for `.parcelrc` files there to name. `None` when
/// Swift 6.2 or later is not installed.
fn plugin_dir() -> Option<&'static Path> {
  static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
  DIR
    .get_or_init(|| {
      if !swift_supported() {
        return None;
      }

      let package = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugin-swift/Examples");
      let result = std::process::Command::new("swift")
        .args(["build", "--package-path"])
        .arg(&package)
        .output()
        .expect("spawn swift build");
      assert!(
        result.status.success(),
        "swift build failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr),
      );

      let dir = std::env::temp_dir().join("parcel-swift-test");
      std::fs::create_dir_all(&dir).expect("create temp directory");
      for example in EXAMPLES {
        std::fs::copy(
          package.join(format!(".build/debug/lib{example}.{LIB_EXT}")),
          dir.join(format!("{example}.{LIB_EXT}")),
        )
        .unwrap_or_else(|error| panic!("copy {example}: {error}"));
      }
      Some(dir)
    })
    .as_deref()
}

/// Whether a Swift toolchain new enough for the SDK (6.2) is installed. CI
/// runner images ship whatever Swift they ship, so an older one skips these
/// tests rather than failing to build the examples.
fn swift_supported() -> bool {
  let Ok(output) = std::process::Command::new("swift")
    .arg("--version")
    .output()
  else {
    return false;
  };
  // e.g. "Apple Swift version 6.2 (swiftlang-…)" or "Swift version 6.2.1 (swift-6.2.1-RELEASE)".
  let version =
    String::from_utf8_lossy(&output.stdout).into_owned() + &String::from_utf8_lossy(&output.stderr);
  let Some((_, rest)) = version.split_once("Swift version ") else {
    return false;
  };
  let mut parts = rest.split(|c: char| !c.is_ascii_digit());
  let major: u32 = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
  let minor: u32 = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
  output.status.success() && (major, minor) >= (6, 2)
}

/// Writes `parcelrc` to the plugin directory, and builds `entry` in `fixture`
/// with it. `None` when Swift is not installed.
fn build(
  fixture: &str,
  entry: &str,
  name: &str,
  parcelrc: &str,
) -> Option<(
  Result<parcel_core::BundleGraph<'static>, DiagnosticList>,
  Arc<OverlayFileSystem>,
)> {
  let dir = plugin_dir()?;
  let parcelrc_path = dir.join(format!("{name}.parcelrc"));
  std::fs::write(&parcelrc_path, parcelrc.replace("{ext}", LIB_EXT)).expect("write parcelrc");

  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
    .join("tests/fixtures")
    .join(fixture);
  let output_fs = Arc::new(OverlayFileSystem::new());
  let result = parcel::build(
    &vec![entry.into()],
    BuildOptions {
      cwd: PathId::new(&fixture_dir),
      config: Some(parcelrc_path.to_string_lossy().into_owned()),
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
  );
  Some((result, output_fs))
}

/// The contents of every bundle of type `ty` in a build.
fn outputs(
  bundle_graph: &parcel_core::BundleGraph,
  output_fs: &OverlayFileSystem,
  ty: parcel_core::AssetType,
) -> String {
  bundle_graph
    .bundles
    .iter()
    .filter(|bundle| bundle.ty == ty && bundle.dist_path.is_some())
    .map(|bundle| {
      output_fs
        .read_to_string(bundle.dist_path())
        .expect("read bundle")
    })
    .collect::<Vec<_>>()
    .join("\n--- bundle ---\n")
}

fn load(
  example: &str,
  config: Option<&serde_json::Value>,
) -> Option<Result<CPlugin, DiagnosticList>> {
  let path = plugin_dir()?.join(format!("{example}.{LIB_EXT}"));
  Some(CPlugin::new(PathId::new(&path), "test-plugin", config))
}

macro_rules! require_swift {
  ($value:expr) => {
    match $value {
      Some(value) => value,
      None => {
        eprintln!("Swift 6.2 or later not available – skipping Swift plugin test");
        return;
      }
    }
  };
}

// ── Transformer ─────────────────────────────────────────────────────────────

#[test]
fn swift_transformer() {
  let (result, output_fs) = require_swift!(build(
    "native-plugin",
    "index.js",
    "transformer",
    r#"{"extends":"@parcel/config-default","transformers":{"*.txt":["./TxtTransformer.{ext}"]}}"#,
  ));
  let bundle_graph = result.unwrap_or_else(|error| panic!("parcel build failed: {error:?}"));
  let content = outputs(&bundle_graph, &output_fs, parcel_core::AssetType::Js);
  assert!(content.contains(r#""Hello from Go!""#), "got:\n{content}");
}

#[test]
fn swift_transformer_reads_the_input_source_map() {
  let dir = require_swift!(plugin_dir());
  common::assert_prepend_keeps_input_map(
    "swift",
    &dir.join(format!("PrependTransformer.{LIB_EXT}")),
  );
}

#[test]
fn swift_plugin_config_is_decoded() {
  let config = serde_json::json!({ "prefix": "Swift says: " });
  require_swift!(load("TxtTransformer", Some(&config))).expect("load with a valid config");
}

#[test]
fn swift_plugin_config_errors_name_the_key() {
  let config = serde_json::json!({ "prefix": 5 });
  let Err(error) = require_swift!(load("TxtTransformer", Some(&config))) else {
    panic!("expected an invalid config to fail");
  };
  assert!(
    error.0[0]
      .message
      .contains("Invalid plugin config at prefix"),
    "got: {}",
    error.0[0].message
  );
}

// ── Resolver ────────────────────────────────────────────────────────────────

#[test]
fn swift_resolver() {
  let (result, output_fs) = require_swift!(build(
    "native-resolver",
    "index.js",
    "resolver",
    r#"{"extends":"@parcel/config-default","resolvers":["./CustomResolver.{ext}","..."]}"#,
  ));
  let bundle_graph = result.unwrap_or_else(|error| panic!("parcel build failed: {error:?}"));
  let content = outputs(&bundle_graph, &output_fs, parcel_core::AssetType::Js);
  assert!(
    content.contains("Hello from native resolver!"),
    "got:\n{content}"
  );
}

// ── Namer ───────────────────────────────────────────────────────────────────

#[test]
fn swift_namer() {
  let (result, output_fs) = require_swift!(build(
    "native-namer",
    "index.js",
    "namer",
    r#"{"extends":"@parcel/config-default","namers":["./CustomNamer.{ext}","..."]}"#,
  ));
  let bundle_graph = result.unwrap_or_else(|error| panic!("parcel build failed: {error:?}"));
  let js_bundle = bundle_graph
    .bundles
    .iter()
    .find(|bundle| bundle.ty == parcel_core::AssetType::Js)
    .expect("no JS bundle in output");
  assert_eq!(js_bundle.name(), "swift-index.js");
  assert!(output_fs.read_to_string(js_bundle.dist_path()).is_ok());
}

// ── Optimizer ───────────────────────────────────────────────────────────────

#[test]
fn swift_optimizer() {
  let (result, output_fs) = require_swift!(build(
    "native-optimizer",
    "index.css",
    "optimizer",
    r#"{"extends":"@parcel/config-default","optimizers":{"*.css":["./CustomOptimizer.{ext}"]}}"#,
  ));
  let bundle_graph = result.unwrap_or_else(|error| panic!("parcel build failed: {error:?}"));
  let css_bundle = bundle_graph
    .bundles
    .iter()
    .find(|bundle| bundle.ty == parcel_core::AssetType::Css)
    .expect("no CSS bundle in output");
  let content = output_fs
    .read_to_string(css_bundle.dist_path())
    .expect("read optimized bundle");
  assert!(
    content.contains("/* optimized by Swift:"),
    "got:\n{content}"
  );
  assert!(content.contains("type=css map=true"), "got:\n{content}");
  assert!(
    output_fs
      .read(css_bundle.dist_path().add_extension("map"))
      .is_ok(),
    "optimizer did not preserve the source map"
  );
}

// ── Reporter ────────────────────────────────────────────────────────────────

/// Calls `parcel_plugin_report` directly, so each event kind is exercised
/// without needing a build that produces it.
#[test]
fn swift_reporter_receives_every_event_kind() {
  let plugin = require_swift!(load("CustomReporter", None)).expect("load plugin");
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

/// A library used for a role its plugin type does not conform to says so.
#[test]
fn swift_plugin_used_for_the_wrong_role_says_so() {
  let plugin = require_swift!(load("CustomNamer", None)).expect("load plugin");
  let error = plugin
    .report(&ReporterEvent::BuildStart, &ParcelOptions::default())
    .expect_err("a namer is not a reporter");
  assert!(
    error.0[0]
      .message
      .contains("CustomNamer is configured as a reporter, but is not one"),
    "got: {}",
    error.0[0].message
  );
}

#[test]
fn swift_reporter_in_a_build() {
  let (result, _) = require_swift!(build(
    "native-namer",
    "index.js",
    "reporter",
    r#"{"extends":"@parcel/config-default","reporters":["./CustomReporter.{ext}"]}"#,
  ));
  result.unwrap_or_else(|error| panic!("parcel build failed: {error:?}"));
}

// ── Custom content ──────────────────────────────────────────────────────────

const CUSTOM_CONTENT_PARCELRC: &str = r#"{"extends":"@parcel/config-default","transformers":{"*.upper":["./CustomContentTransformer.{ext}"],"*.upper.js":["./CustomContentTransformer.{ext}"]}}"#;

#[test]
fn swift_custom_content() {
  let (result, output_fs) = require_swift!(build(
    "custom-content-plugin",
    "index.js",
    "custom-content",
    CUSTOM_CONTENT_PARCELRC,
  ));
  let bundle_graph = result.unwrap_or_else(|error| panic!("parcel build failed: {error:?}"));
  let content = outputs(&bundle_graph, &output_fs, parcel_core::AssetType::Js);
  assert!(
    content.contains("HELLO FROM CUSTOM GO CONTENT"),
    "got:\n{content}"
  );
  assert!(
    content.contains("// custom-content assets="),
    "got:\n{content}"
  );
}

fn assert_build_fails(entry: &str, name: &str, expected: &str) {
  let (result, _) = require_swift!(build(
    "custom-content-plugin",
    entry,
    name,
    CUSTOM_CONTENT_PARCELRC,
  ));
  let Err(diagnostics) = result else {
    panic!("expected build to fail with {expected:?}");
  };
  assert!(
    diagnostics
      .0
      .iter()
      .any(|diagnostic| diagnostic.message.contains(expected)),
    "expected a diagnostic containing {expected:?}, got: {diagnostics:?}"
  );
}

#[test]
fn swift_transform_error_becomes_diagnostic() {
  assert_build_fails(
    "panic-transform.js",
    "transform-error",
    "example transform error",
  );
}

#[test]
fn swift_custom_content_read_error_becomes_diagnostic() {
  assert_build_fails(
    "panic-read.js",
    "read-error",
    "example custom content read error",
  );
}

#[test]
fn swift_custom_content_package_error_becomes_diagnostic() {
  assert_build_fails(
    "panic-package.js",
    "package-error",
    "example custom content package error",
  );
}

// ── Async ───────────────────────────────────────────────────────────────────

/// Awaits an actor, fans work out to Swift's pool, and resolves from inside a
/// transform through this same library's resolver: a re-entrant call on the
/// thread whose task is suspended in the host call.
#[test]
fn swift_async_plugin() {
  let (result, output_fs) = require_swift!(build(
    "native-async",
    "index.js",
    "async",
    r#"{"extends":"@parcel/config-default","transformers":{"*.greeting":["./AsyncPlugin.{ext}"]},"resolvers":["./AsyncPlugin.{ext}","..."]}"#,
  ));
  let bundle_graph = result.unwrap_or_else(|error| panic!("parcel build failed: {error:?}"));
  let content = outputs(&bundle_graph, &output_fs, parcel_core::AssetType::Js);
  assert!(
    content.contains(r#""HELLO FROM SWIFT AND FROM ASYNC CODE" + "#),
    "got:\n{content}"
  );
  assert!(
    content.contains(r#"resolved = "suffix.js""#),
    "got:\n{content}"
  );
  assert!(
    content.contains(r#""!""#),
    "suffix module missing:\n{content}"
  );
}
