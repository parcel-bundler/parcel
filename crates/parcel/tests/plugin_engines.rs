use std::{
  path::Path,
  sync::{Arc, Mutex},
};

use parcel_core::{
  BuildMode, BuildOptions, Diagnostic, DiagnosticList, DiagnosticSeverity, FileSystem, LogLevel,
  LogMessage, MemoryFileSystem, ParcelOptions, PathId, Reporter, ReporterEvent,
};

#[derive(Default)]
struct Warnings(Mutex<Vec<Diagnostic>>);

impl Reporter for Warnings {
  fn report(&self, event: &ReporterEvent, _: &ParcelOptions) -> Result<(), DiagnosticList> {
    if let ReporterEvent::Log(log) = event {
      // Errors from loading the config are logged too, but the tests check them through the
      // result of the build.
      if log.level == LogLevel::Error {
        return Ok(());
      }
      if let LogMessage::Diagnostics(diagnostics) = log.message {
        assert_eq!(log.level, LogLevel::Warn);
        self.0.lock().unwrap().extend(diagnostics.iter().cloned());
      }
    }
    Ok(())
  }
}

const TRANSFORMER: &str = r#"
  module.exports = {[Symbol.for('parcel-plugin-config')]: {
    transform({asset}) {
      return [asset];
    }
  }};
"#;

/// A plugin package in node_modules with the given package.json `engines` field.
fn plugin(name: &str, engines: &str) -> [(String, String); 2] {
  [
    (
      format!("node_modules/{name}/package.json"),
      format!(r#"{{"name": "{name}", "version": "1.0.0", "main": "index.js"{engines}}}"#),
    ),
    (format!("node_modules/{name}/index.js"), TRANSFORMER.into()),
  ]
}

fn build(files: &[(String, String)]) -> (Result<(), DiagnosticList>, Vec<Diagnostic>) {
  let input = Arc::new(MemoryFileSystem::new());
  let defaults = [
    ("package.json", "{}"),
    ("index.js", "module.exports = 1;"),
    ("local.cjs", TRANSFORMER),
  ]
  .map(|(file, code)| (file.to_string(), code.to_string()));
  for (file, code) in defaults.iter().chain(files) {
    let path = Path::new("/project").join(file);
    input
      .create_dir_all(PathId::new(path.parent().unwrap()))
      .unwrap();
    input
      .write(PathId::new(&path), &code.as_bytes().to_vec())
      .unwrap();
  }
  let warnings = Arc::new(Warnings::default());
  let result = parcel::build(
    &vec!["/project/index.js".into()],
    BuildOptions {
      mode: BuildMode::Development,
      optimize: None,
      content_hash: None,
      source_map: None,
      env: Default::default(),
      log_level: LogLevel::Warn,
      input_fs: input,
      output_fs: Arc::new(MemoryFileSystem::new()),
      config: None,
      cwd: PathId::new(Path::new("/project")),
      dist_dir: None,
      public_url: "/".into(),
      hmr: None,
      reporters: vec![warnings.clone()],
    },
  );
  let warnings = warnings.0.lock().unwrap().clone();
  (result.map(|_| ()), warnings)
}

fn parcelrc(json: &str) -> (String, String) {
  (".parcelrc".into(), json.into())
}

#[test]
fn accepts_plugins_that_support_parcel_3_prereleases() {
  let mut files = vec![parcelrc(
    r#"{"extends": "@parcel/config-default", "transformers": {"*.js": ["parcel-transformer-ok", "..."]}}"#,
  )];
  files.extend(plugin(
    "parcel-transformer-ok",
    r#", "engines": {"node": ">= 16", "parcel": "^3.0.0-0"}"#,
  ));
  let (result, warnings) = build(&files);
  result.unwrap();
  assert_eq!(warnings, vec![]);
}

#[test]
fn rejects_incompatible_plugins() {
  let mut files = vec![parcelrc(
    r#"{"extends": "@parcel/config-default", "transformers": {"*.js": ["parcel-transformer-old", "..."]}}"#,
  )];
  files.extend(plugin(
    "parcel-transformer-old",
    r#",
  "engines": {"parcel": "2.x"}"#,
  ));
  let (result, _) = build(&files);
  let diagnostics = result.unwrap_err().0;
  assert_eq!(diagnostics.len(), 1);
  let diagnostic = &diagnostics[0];
  assert_eq!(
    diagnostic.message,
    r#"The plugin "parcel-transformer-old" is not compatible with the current version of Parcel. Requires "2.x" but the current version is "3.0.0-0"."#
  );
  assert_eq!(diagnostic.origin.as_deref(), Some("@parcel/core"));
  let frame = &diagnostic.code_frames[0];
  assert!(
    frame
      .url
      .as_ref()
      .unwrap()
      .to_string()
      .ends_with("/project/node_modules/parcel-transformer-old/package.json")
  );
  let highlight = &frame.code_highlights[0];
  assert_eq!(
    (highlight.start.line, highlight.start.column),
    (2, 25),
    "{highlight:?}"
  );
  assert_eq!(
    (highlight.end.line, highlight.end.column),
    (2, 29),
    "{highlight:?}"
  );
}

#[test]
fn rejects_invalid_ranges() {
  let mut files = vec![parcelrc(
    r#"{"extends": "@parcel/config-default", "reporters": ["parcel-reporter-invalid"]}"#,
  )];
  files.extend(plugin(
    "parcel-reporter-invalid",
    r#", "engines": {"parcel": "not a range"}"#,
  ));
  let (result, _) = build(&files);
  let diagnostics = result.unwrap_err().0;
  assert!(
    diagnostics[0]
      .message
      .starts_with(r#"The plugin "parcel-reporter-invalid" is not compatible"#),
    "{diagnostics:?}"
  );
}

#[test]
fn warns_once_about_plugins_without_a_range() {
  let mut files = vec![parcelrc(
    r#"{
      "extends": "@parcel/config-default",
      "transformers": {
        "*.js": ["parcel-transformer-unversioned", "./local.cjs", "..."],
        "*.mjs": ["parcel-transformer-unversioned", "..."]
      }
    }"#,
  )];
  files.extend(plugin("parcel-transformer-unversioned", ""));
  let (result, warnings) = build(&files);
  result.unwrap();
  assert_eq!(warnings.len(), 1, "{warnings:?}");
  assert_eq!(
    warnings[0].message,
    "The plugin \"parcel-transformer-unversioned\" needs to specify a `package.json#engines.parcel` field with the supported Parcel version range."
  );
  assert_eq!(warnings[0].severity, DiagnosticSeverity::Warning);
}

#[test]
fn rejects_incompatible_config_packages() {
  let files = vec![
    parcelrc(r#"{"extends": "parcel-config-old"}"#),
    (
      "node_modules/parcel-config-old/package.json".into(),
      r#"{"name": "parcel-config-old", "main": "index.json", "engines": {"parcel": "^2.0.0"}}"#
        .into(),
    ),
    (
      "node_modules/parcel-config-old/index.json".into(),
      r#"{"extends": "@parcel/config-default"}"#.into(),
    ),
  ];
  let (result, _) = build(&files);
  let diagnostics = result.unwrap_err().0;
  assert_eq!(
    diagnostics[0].message,
    r#"The config "parcel-config-old" is not compatible with the current version of Parcel. Requires "^2.0.0" but the current version is "3.0.0-0"."#
  );
  assert_eq!(diagnostics[0].code_frames.len(), 1);
}

#[test]
fn does_not_warn_about_config_packages_without_a_range() {
  let files = vec![
    parcelrc(r#"{"extends": "parcel-config-unversioned"}"#),
    (
      "node_modules/parcel-config-unversioned/package.json".into(),
      r#"{"name": "parcel-config-unversioned", "main": "index.json"}"#.into(),
    ),
    (
      "node_modules/parcel-config-unversioned/index.json".into(),
      r#"{"extends": "@parcel/config-default"}"#.into(),
    ),
  ];
  let (result, warnings) = build(&files);
  result.unwrap();
  assert_eq!(warnings, vec![]);
}
