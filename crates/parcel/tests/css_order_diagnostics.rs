use std::{
  path::Path,
  sync::{Arc, Mutex},
};

use parcel_core::{
  BuildMode, BuildOptions, CodeFrame, Diagnostic, DiagnosticList, DiagnosticSeverity, FileSystem,
  LogLevel, LogMessage, MemoryFileSystem, ParcelOptions, PathId, Reporter, ReporterEvent,
};

#[derive(Default)]
struct Warnings(Mutex<Vec<Diagnostic>>);

impl Reporter for Warnings {
  fn report(&self, event: &ReporterEvent, _: &ParcelOptions) -> Result<(), DiagnosticList> {
    if let ReporterEvent::Log(log) = event {
      if let LogMessage::Diagnostics(diagnostics) = log.message {
        for diagnostic in diagnostics {
          if diagnostic
            .message
            .contains("imported in conflicting orders")
          {
            assert_eq!(log.level, LogLevel::Warn);
            self.0.lock().unwrap().push(diagnostic.clone());
          }
        }
      } else if let LogMessage::Text(message) = log.message {
        assert!(!message.contains("imported in conflicting orders"));
      }
    }
    Ok(())
  }
}

fn build(files: &[(&str, &str)], mode: BuildMode) -> Vec<Diagnostic> {
  build_entries(files, &["first.js", "second.js"], mode)
}

fn build_entries(files: &[(&str, &str)], entries: &[&str], mode: BuildMode) -> Vec<Diagnostic> {
  let input = Arc::new(MemoryFileSystem::new());
  for &(file, code) in files.iter().chain(
    [
      ("package.json", "{}"),
      ("x.css", ".x { color: red; }"),
      ("y.css", ".y { color: blue; }"),
      (
        "node_modules/@parcel/parcel3/package.json",
        r#"{"name":"@parcel/parcel3","version":"3.0.0"}"#,
      ),
      (
        "node_modules/@parcel/parcel3/src/esmodule-helpers.js",
        include_str!("../../../packages/core/parcel3/src/esmodule-helpers.js"),
      ),
    ]
    .iter(),
  ) {
    let path = Path::new("/project").join(file);
    input
      .create_dir_all(PathId::new(path.parent().unwrap()))
      .unwrap();
    input
      .write(PathId::new(&path), &code.as_bytes().to_vec())
      .unwrap();
  }
  let warnings = Arc::new(Warnings::default());
  parcel::build(
    &entries
      .iter()
      .map(|entry| format!("/project/{entry}"))
      .collect(),
    BuildOptions {
      mode,
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
  )
  .expect("conflicting CSS orders must not fail the build");
  warnings.0.lock().unwrap().clone()
}

fn frame<'a>(diagnostic: &'a Diagnostic, file: &str) -> &'a CodeFrame {
  diagnostic
    .code_frames
    .iter()
    .find(|frame| {
      frame.url.as_ref().unwrap().to_file_path().unwrap()
        == PathId::new(&Path::new("/project").join(file))
    })
    .unwrap_or_else(|| panic!("missing frame for {file}: {diagnostic:#?}"))
}

fn assert_import(frame: &CodeFrame, line: u32, specifier: &str, message: &str) {
  let highlight = frame
    .code_highlights
    .iter()
    .find(|highlight| {
      highlight.start.line == line
        && highlight
          .message
          .as_deref()
          .is_some_and(|m| m.contains(message))
    })
    .unwrap_or_else(|| panic!("missing import on line {line}: {frame:#?}"));
  assert_eq!(highlight.end.line, line);
  let code = frame
    .code
    .as_ref()
    .expect("source is loaded from the input filesystem");
  let source = code.lines().nth(line as usize - 1).unwrap();
  assert!(source.contains(specifier));
  let highlighted = &source[(highlight.start.column - 1) as usize..highlight.end.column as usize];
  assert!(highlighted.contains(specifier) || highlighted == "@import");
}

#[test]
fn conflicting_orders_report_both_import_locations() {
  let first = "import './x.css';\nimport './y.css';\n";
  let second = "import './y.css';\nimport './x.css';\n";
  for mode in [BuildMode::Development, BuildMode::Production] {
    let diagnostics = build(&[("first.js", first), ("second.js", second)], mode);
    assert_eq!(diagnostics.len(), 1, "one diagnostic per conflicting group");
    let diagnostic = &diagnostics[0];
    assert_eq!(diagnostic.severity, DiagnosticSeverity::Warning);
    assert_eq!(
      diagnostic.origin.as_deref(),
      Some("@parcel/bundler-default")
    );
    assert_eq!(diagnostic.code_frames.len(), 2);
    let first_frame = frame(diagnostic, "first.js");
    assert_eq!(first_frame.code.as_deref(), Some(first));
    assert_import(first_frame, 1, "./x.css", "Order 1: x.css before y.css");
    assert_import(first_frame, 2, "./y.css", "Order 1: y.css after x.css");
    let second_frame = frame(diagnostic, "second.js");
    assert_import(second_frame, 1, "./y.css", "Order 2: y.css before x.css");
    assert_import(second_frame, 2, "./x.css", "Order 2: x.css after y.css");
    assert!(
      diagnostic
        .hints
        .contains(&"Order 1: x.css → y.css\nUsed by:\n  first.js".into())
    );
    assert!(
      diagnostic
        .hints
        .contains(&"Order 2: y.css → x.css\nUsed by:\n  second.js".into())
    );
  }
}

#[test]
fn indirect_imports_show_the_context_that_orders_shared_modules() {
  let diagnostics = build(
    &[
      ("first.js", "import './a.js';\nimport './b.js';"),
      ("second.js", "import './b.js';\nimport './a.js';"),
      ("a.js", "import './x.css';"),
      ("b.js", "import './y.css';"),
    ],
    BuildMode::Development,
  );
  assert_eq!(diagnostics.len(), 1);
  let diagnostic = &diagnostics[0];
  assert_import(
    frame(diagnostic, "first.js"),
    1,
    "./a.js",
    "Order 1: x.css before y.css",
  );
  assert_import(
    frame(diagnostic, "second.js"),
    2,
    "./a.js",
    "Order 2: x.css after y.css",
  );
  assert_eq!(
    diagnostic.code_frames.len(),
    2,
    "only show imports where the paths diverge"
  );
}

#[test]
fn repeated_css_imports_highlight_the_retained_last_occurrence() {
  let diagnostics = build(
    &[
      ("first.js", "import './a.css';"),
      ("second.js", "import './b.css';"),
      (
        "a.css",
        "@import './x.css';\n@import './y.css';\n@import './x.css';",
      ),
      ("b.css", "@import './x.css';\n@import './y.css';"),
    ],
    BuildMode::Development,
  );
  assert_eq!(diagnostics.len(), 1);
  let diagnostic = &diagnostics[0];
  let a = frame(diagnostic, "a.css");
  assert_eq!(a.code_highlights.len(), 2);
  assert_import(a, 2, "./y.css", "Order 1: y.css before x.css");
  assert_import(a, 3, "./x.css", "Order 1: x.css after y.css");
  assert_import(
    frame(diagnostic, "b.css"),
    1,
    "./x.css",
    "Order 2: x.css before y.css",
  );
}

#[test]
fn consistent_orders_do_not_warn() {
  assert!(
    build(
      &[
        ("first.js", "import './x.css';\nimport './y.css';"),
        ("second.js", "import './x.css';\nimport './y.css';"),
      ],
      BuildMode::Development
    )
    .is_empty()
  );
}

#[test]
fn contexts_with_the_same_order_share_an_example() {
  let diagnostics = build_entries(
    &[
      ("first.js", "import './x.css';\nimport './y.css';"),
      ("second.js", "import './y.css';\nimport './x.css';"),
      ("third.js", "import './x.css';\nimport './y.css';"),
    ],
    &["first.js", "second.js", "third.js"],
    BuildMode::Development,
  );
  assert_eq!(diagnostics.len(), 1);
  let diagnostic = &diagnostics[0];
  let orders: Vec<_> = diagnostic
    .hints
    .iter()
    .filter(|h| h.starts_with("Order "))
    .collect();
  assert_eq!(orders.len(), 2);
  let shared = orders.iter().find(|h| h.contains("x.css → y.css")).unwrap();
  assert!(shared.contains("first.js") && shared.contains("third.js"));
  assert_eq!(diagnostic.code_frames.len(), 2);
  assert!(
    diagnostic
      .code_frames
      .iter()
      .flat_map(|f| &f.code_highlights)
      .all(|h| !h.message.as_ref().unwrap().contains("stylesheet #"))
  );
}

#[test]
fn nested_imports_highlight_where_the_paths_diverge() {
  let diagnostics = build(
    &[
      ("first.js", "import './a.js';"),
      ("second.js", "import './b.js';"),
      ("a.js", "import './x.css';\nimport './y.css';"),
      ("b.js", "import './y.css';\nimport './x.css';"),
    ],
    BuildMode::Development,
  );
  assert_eq!(diagnostics.len(), 1);
  let diagnostic = &diagnostics[0];
  assert_eq!(diagnostic.code_frames.len(), 2);
  assert_import(
    frame(diagnostic, "a.js"),
    1,
    "./x.css",
    "Order 1: x.css before y.css",
  );
  assert_import(
    frame(diagnostic, "b.js"),
    1,
    "./y.css",
    "Order 2: y.css before x.css",
  );
}

#[test]
fn transformed_imports_show_the_source_their_locations_refer_to() {
  let diagnostics = build(
    &[
      ("first.js", "import './x.css';\nimport './y.css';"),
      ("second.js", "import './y.css';\nimport './x.css';"),
      (
        ".parcelrc",
        r#"{
      "extends": "@parcel/config-default",
      "transformers": {"{first,second}.js": ["./rewrite.cjs", "..."]}
    }"#,
      ),
      (
        "rewrite.cjs",
        r#"
      module.exports = {[Symbol.for('parcel-plugin-config')]: {
        transform({asset}) {
          asset.setCode('// generated\n\n' + asset.getCode());
          return [asset];
        }
      }};
    "#,
      ),
    ],
    BuildMode::Development,
  );
  assert_eq!(diagnostics.len(), 1);
  let first = frame(&diagnostics[0], "first.js");
  assert_import(
    first,
    3,
    "./x.css",
    "Order 1: x.css before y.css (transformed source)",
  );
  assert!(first.code.as_ref().unwrap().starts_with("// generated\n\n"));
}
