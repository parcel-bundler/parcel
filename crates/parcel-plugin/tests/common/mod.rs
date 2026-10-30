//! Shared by the SDKs' tests, so each SDK is held to the same behavior: the
//! prepend-transformer tests check that a native transformer can read the source
//! map an earlier transformer attached, and the reporter tests that a native
//! reporter can read every part of a diagnostic. Each test file uses only some
//! of this.
#![allow(dead_code)]

use std::{path::Path, sync::Arc};

use parcel_core::{
  AssetType, BuildOptions, FileSystem, LogLevel, OsFileSystem, OverlayFileSystem, PathId,
};
use parcel_sourcemap::SourceMap;

const INDEX_JS: &str = r#"// The first line.
globalThis.output = "prepend-source-map-token";
"#;

/// A JS transformer that runs before the native one and moves the code down a
/// line, along with a (line-granular) map back to the original file.
const SET_MAP_PLUGIN: &str = r#"export default {
  [Symbol.for('parcel-plugin-config')]: {
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
      url: Some(parcel_core::SourceUrl::from_path(&PathId::new(Path::new(
        "/project/src/a.js",
      )))),
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
    "message: it did not work\n\
     docs: https://parceljs.org/errors/example\n\
     frame: /project/src/a.js js\n\
     highlight: 1:9-1:12 expected an expression\n"
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
