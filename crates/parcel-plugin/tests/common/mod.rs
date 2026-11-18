//! Shared by the SDKs' tests, so each SDK is held to the same behavior: the
//! prepend-transformer tests check that a native transformer can read the source
//! map an earlier transformer attached, and the reporter tests that a native
//! reporter can read every part of a diagnostic. Each test file uses only some
//! of this.
#![allow(dead_code)]

#[path = "../../../core/tests/support/mod.rs"]
mod test_utils;

use std::{
  path::Path,
  sync::{Arc, Mutex},
};

use parcel_core::{
  AssetType, BuildOptions, CodeFrame, Diagnostic, DiagnosticList, FileSystem, LogEvent, LogLevel,
  LogMessage, OsFileSystem, OverlayFileSystem, ParcelOptions, PathId, Reporter, ReporterEvent,
};
use parcel_sourcemap::SourceMap;

/// Whether Go is installed. Tests that need it skip without it, unless
/// [`require_toolchain`] says it must be there.
pub fn go_available() -> bool {
  let available = std::process::Command::new("go")
    .arg("version")
    .output()
    .is_ok_and(|output| output.status.success());
  require_toolchain("go", available)
}

/// Returns `available`, but panics when it is false and the comma-separated
/// `PARCEL_REQUIRE_TOOLCHAINS` names `toolchain`. Tests skip, and pass, when a
/// toolchain they need is not installed; CI sets the variable to the
/// toolchains its runners have, so one going missing from a runner image fails
/// the build rather than silently dropping coverage.
pub fn require_toolchain(toolchain: &str, available: bool) -> bool {
  let required = std::env::var("PARCEL_REQUIRE_TOOLCHAINS")
    .is_ok_and(|required| required.split(',').any(|name| name.trim() == toolchain));
  assert!(
    available || !required,
    "PARCEL_REQUIRE_TOOLCHAINS requires {toolchain}, but it is not installed"
  );
  available
}

const INDEX_JS: &str = r#"// The first line.
globalThis.output = "prepend-source-map-token";
"#;

/// A JS transformer that runs before the native one and moves the code down a
/// line, along with a (line-granular) map back to the original file.
const SET_MAP_PLUGIN: &str = r#"export default {
  [Symbol.for('parcel.plugin.v3.transformer')]: {
    transform({asset}) {
      let code = asset.getCode();
      let lines = code.split('\n');
      asset.setCode('globalThis.before = 1;\n' + code, {
        version: 3,
        sources: [asset.filePath],
        sourcesContent: [code],
        names: [],
        mappings: ';' + lines.map((_, i) => (i === 0 ? 'AAAA' : 'AACA')).join(';'),
      });
      return [asset];
    },
  },
};
"#;

/// Builds a project whose JS goes through a JS transformer that attaches a map
/// and then the native prepend transformer at `library`, and asserts that the
/// bundle still maps back to the original file. That only works if the native
/// transformer read the first map and passed it on, moved down by its line.
pub fn assert_prepend_keeps_input_map(name: &str, library: &Path) {
  let dir = std::env::temp_dir()
    .join("parcel-native-source-map-test")
    .join(name);
  std::fs::create_dir_all(&dir).expect("create project directory");
  for (file, contents) in [
    ("package.json", "{}"),
    ("yarn.lock", ""),
    ("index.js", INDEX_JS),
    ("set-map.mjs", SET_MAP_PLUGIN),
  ] {
    std::fs::write(dir.join(file), contents).expect("write project file");
  }
  let parcelrc = dir.join(".parcelrc");
  std::fs::write(
    &parcelrc,
    format!(
      r#"{{"extends":"@parcel/config-default","transformers":{{"*.js":["./set-map.mjs",{{"plugin":{:?},"config":{{"line":"globalThis.prepended = true;"}}}},"..."]}}}}"#,
      library.to_str().unwrap()
    ),
  )
  .expect("write parcelrc");

  let output_fs = Arc::new(OverlayFileSystem::new());
  let bundle_graph = parcel::build(
    &vec!["index.js".into()],
    BuildOptions {
      cwd: PathId::new(&dir),
      config: Some(parcelrc.to_str().unwrap().to_owned()),
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
  .unwrap_or_else(|e| panic!("parcel build failed: {:?}", e));

  let bundle = bundle_graph
    .bundles
    .iter()
    .find(|b| b.ty == AssetType::Js)
    .expect("no JS bundle in output");
  let code = output_fs
    .read_to_string(bundle.dist_path())
    .expect("read bundle");
  let map = output_fs
    .read_to_string(bundle.dist_path().add_extension("map"))
    .expect("read bundle source map");
  // The native transformer ran: its line is code, so it survives the JS transformer.
  assert!(code.contains("globalThis.prepended = true"), "{code}");

  let token = "\"prepend-source-map-token\"";
  let offset = code.find(token).expect("token in bundle");
  let line = code[..offset].matches('\n').count() as u32;
  let column = (offset - code[..offset].rfind('\n').map_or(0, |i| i + 1)) as u32;
  let (source, original_line) = original_line(&map, line, column)
    .unwrap_or_else(|| panic!("no mapping for the token at {line}:{column} in {map}"));
  assert!(source.ends_with("index.js"), "{source}");
  // Line 1 of index.js. Without the input map it would be line 3, where the
  // token is once both transformers have added a line above it.
  assert_eq!(original_line, 1, "{map}");
}

/// The source and original line `line:column` of the generated code maps to.
fn original_line(map: &str, line: u32, column: u32) -> Option<(String, u32)> {
  let value: serde_json::Value = serde_json::from_str(map).unwrap();
  // Development builds write an index map, with one section per asset.
  let sections = match value.get("sections") {
    Some(sections) => sections
      .as_array()
      .unwrap()
      .iter()
      .map(|section| {
        (
          section["offset"]["line"].as_u64().unwrap() as u32,
          section["offset"]["column"].as_u64().unwrap() as u32,
          section["map"].to_string(),
        )
      })
      .collect(),
    None => vec![(0, 0, map.to_owned())],
  };

  let mut best = None;
  for (line_offset, column_offset, json) in sections {
    let map = SourceMap::from_json("/", &json).unwrap();
    for mapping in map.get_mappings() {
      let Some(original) = mapping.original else {
        continue;
      };
      let generated_line = line_offset + mapping.generated_line;
      let generated_column = if mapping.generated_line == 0 {
        column_offset + mapping.generated_column
      } else {
        mapping.generated_column
      };
      if generated_line == line
        && generated_column <= column
        && best.as_ref().is_none_or(|(c, _, _)| *c <= generated_column)
      {
        best = Some((
          generated_column,
          map.get_source(original.source).unwrap().to_owned(),
          original.original_line,
        ));
      }
    }
  }
  best.map(|(_, source, line)| (source, line))
}

/// A failed build's diagnostic with every part a native reporter can read: a
/// documentation URL, and a code frame with a ranged, labelled highlight.
fn failed_build_diagnostics() -> parcel_core::DiagnosticList {
  parcel_core::DiagnosticList(vec![parcel_core::Diagnostic {
    message: "it did not work".into(),
    origin: Some("@acme/plugin".into()),
    hints: vec!["try something else".into()],
    code_frames: vec![parcel_core::CodeFrame {
      url: Some(parcel_core::SourceUrl::from_path(&PathId::new(
        &test_utils::path("/project/src/a.js"),
      ))),
      language: Some(AssetType::Js),
      code_highlights: vec![parcel_core::CodeHighlight {
        start: parcel_core::Location { line: 1, column: 9 },
        end: parcel_core::Location {
          line: 1,
          column: 12,
        },
        message: Some("expected an expression".into()),
      }],
      ..Default::default()
    }],
    documentation_url: Some("https://parceljs.org/errors/example".into()),
    ..parcel_core::Diagnostic::from_message(String::new())
  }])
}

/// Reports a failed build to `plugin`, one of the SDKs' custom-reporter
/// examples, which writes a summary of the diagnostics to the file the build's
/// `REPORT_SUMMARY` names. Every SDK's summary must be the same.
pub fn assert_reporter_summarizes_failures(name: &str, plugin: &parcel_plugin_abi::CPlugin) {
  use parcel_core::Reporter;

  let summary = std::env::temp_dir().join(format!("parcel-{name}-report-summary.txt"));
  let _ = std::fs::remove_file(&summary);
  let options = parcel_core::ParcelOptions {
    env: [(
      "REPORT_SUMMARY".to_string(),
      summary.to_string_lossy().into_owned(),
    )]
    .into(),
    ..Default::default()
  };

  plugin
    .report(
      &parcel_core::ReporterEvent::BuildFailure {
        diagnostics: &failed_build_diagnostics(),
      },
      &options,
    )
    .expect("buildFailure");

  assert_eq!(
    std::fs::read_to_string(&summary).expect("read the summary"),
    format!(
      "message: it did not work\n\
     docs: https://parceljs.org/errors/example\n\
     frame: {} js\n\
     highlight: 1:9-1:12 expected an expression\n",
      test_utils::path("/project/src/a.js").display()
    )
  );
}

/// Checks that a failed custom content read reached the build as one
/// diagnostic, attributed to the plugin. The SDKs' custom-content examples read
/// their content back, so the read's diagnostic travels from Parcel to the plugin
/// and back through its error. Had it been rebuilt or dropped on the way, it
/// would be missing, duplicated, or lack the plugin's origin.
pub fn assert_read_error_passes_through_the_plugin(
  diagnostics: &parcel_core::DiagnosticList,
  expected: &str,
) {
  let reported: Vec<_> = diagnostics
    .0
    .iter()
    .filter(|diagnostic| diagnostic.message.contains(expected))
    .collect();
  assert_eq!(reported.len(), 1, "got: {diagnostics:?}");
  assert!(reported[0].origin.is_some(), "got: {diagnostics:?}");
}

/// Records every diagnostic logged.
#[derive(Default)]
struct DiagnosticRecorder(Mutex<Vec<Diagnostic>>);

impl Reporter for DiagnosticRecorder {
  fn report(&self, event: &ReporterEvent, _options: &ParcelOptions) -> Result<(), DiagnosticList> {
    if let ReporterEvent::Log(LogEvent {
      message: LogMessage::Diagnostics(diagnostics),
      ..
    }) = event
    {
      self.0.lock().unwrap().extend(diagnostics.iter().cloned());
    }
    Ok(())
  }
}

/// Builds `entry` in the native-resolver-diagnostics fixture with the
/// custom-resolver example at `library`, returning the build's result and every
/// diagnostic it logged.
fn build_resolver_diagnostics_fixture(
  entry: &str,
  library: &Path,
) -> (
  Result<parcel_core::BundleGraph<'static>, DiagnosticList>,
  Vec<Diagnostic>,
) {
  let stem = library.file_stem().unwrap().to_string_lossy();
  let dir = std::env::temp_dir().join(format!("parcel-resolver-diagnostics-{stem}-{entry}"));
  std::fs::create_dir_all(&dir).expect("create test directory");
  let parcelrc_path = dir.join(".parcelrc");
  std::fs::write(
    &parcelrc_path,
    format!(
      r#"{{"extends":"@parcel/config-default","resolvers":[{:?}, "..."]}}"#,
      library.to_str().unwrap()
    ),
  )
  .expect("write parcelrc");

  let reporter = Arc::new(DiagnosticRecorder::default());
  let fixture_dir =
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-resolver-diagnostics");
  let result = parcel::build(
    &vec![entry.into()],
    BuildOptions {
      cwd: PathId::new(&fixture_dir),
      config: Some(parcelrc_path.to_str().unwrap().to_owned()),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: Arc::new(OverlayFileSystem::new()),
      mode: parcel_core::BuildMode::Development,
      optimize: None,
      content_hash: None,
      env: Default::default(),
      log_level: LogLevel::Verbose,
      source_map: None,
      dist_dir: None,
      public_url: Default::default(),
      hmr: None,
      reporters: vec![reporter.clone()],
    },
  );
  let logged = std::mem::take(&mut *reporter.0.lock().unwrap());
  (result, logged)
}

fn file_name(frame: &CodeFrame) -> String {
  let url = frame.url.as_ref().expect("frame has a URL").to_string();
  url.rsplit('/').next().unwrap().to_owned()
}

/// The custom-resolver example at `library` fails to resolve a missing
/// `custom:` module with two code frames, one of generated code, and two hints.
pub fn assert_resolver_fails_with_several_code_frames(library: &Path) {
  let (result, _) = build_resolver_diagnostics_fixture("missing.js", library);
  let error = result.expect_err("resolving a missing module should fail");

  let diagnostic = error
    .0
    .iter()
    .find(|d| d.message == "Could not find custom module `nonexistent`")
    .unwrap_or_else(|| panic!("no diagnostic from the resolver in {error:?}"));
  assert_eq!(
    diagnostic.hints.len(),
    2,
    "both hints should be reported: {diagnostic:?}"
  );
  assert!(diagnostic.hints[0].starts_with("Create "), "{diagnostic:?}");
  assert_eq!(diagnostic.hints[1], "Or import a module that exists");

  let [import, suggestion] = &diagnostic.code_frames[..] else {
    panic!("expected two code frames: {diagnostic:?}");
  };
  assert_eq!(file_name(import), "missing.js");
  assert_eq!(
    import.code_highlights[0].message.as_deref(),
    Some("`custom:nonexistent` imported here")
  );
  assert_eq!(
    suggestion.url.as_ref().unwrap().to_string(),
    "custom:nonexistent"
  );
  assert_eq!(
    suggestion.code.as_deref(),
    Some("export default \"nonexistent\";\n")
  );
  assert_eq!(suggestion.language, Some(AssetType::Js));
  assert_eq!(
    suggestion.code_highlights[0].message.as_deref(),
    Some("create it like this")
  );
}

/// The custom-resolver example at `library` logs a warning with two code frames
/// for a `custom-deprecated:` import, without failing the build.
pub fn assert_resolver_logs_a_warning_with_several_code_frames(library: &Path) {
  let (result, logged) = build_resolver_diagnostics_fixture("deprecated.js", library);
  result.unwrap_or_else(|e| panic!("parcel build failed: {e:?}"));

  let warning = logged
    .iter()
    .find(|d| d.message == "`custom-deprecated:` is deprecated")
    .unwrap_or_else(|| panic!("no warning from the resolver in {logged:?}"));
  assert_eq!(warning.severity, parcel_core::DiagnosticSeverity::Warning);
  assert_eq!(warning.hints, ["Import `custom:greeting` instead"]);
  let frames: Vec<String> = warning.code_frames.iter().map(file_name).collect();
  assert_eq!(frames, ["deprecated.js", "greeting.js"]);
  assert_eq!(
    warning.code_frames[1].code_highlights[0].message.as_deref(),
    Some("resolved to this")
  );
}
