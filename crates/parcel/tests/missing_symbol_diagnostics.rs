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
    if let ReporterEvent::Log(log) = event
      && let LogMessage::Diagnostics(diagnostics) = log.message
    {
      for diagnostic in diagnostics {
        if diagnostic.message.contains("does not export") {
          assert_eq!(log.level, LogLevel::Warn);
          self.0.lock().unwrap().push(diagnostic.clone());
        }
      }
    }
    Ok(())
  }
}

const SPRITE: &str = r#"<svg xmlns="http://www.w3.org/2000/svg"><symbol id="home"><path d="M0 0h1v1z"/></symbol></svg>"#;

fn build(entry: &str, files: &[(&str, &str)]) -> Vec<Diagnostic> {
  let input = Arc::new(MemoryFileSystem::new());
  let package_json = [("package.json", "{}")];
  let defaults = if files.iter().any(|&(file, _)| file == "package.json") {
    &[][..]
  } else {
    &package_json[..]
  };
  for &(file, code) in files.iter().chain(defaults) {
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
    &vec![format!("/project/{entry}")],
    BuildOptions {
      mode: BuildMode::Production,
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
  .expect("missing symbols must not fail the build");
  warnings.0.lock().unwrap().clone()
}

fn messages(diagnostics: &[Diagnostic]) -> Vec<&str> {
  diagnostics.iter().map(|d| d.message.as_str()).collect()
}

/// The file and line of a diagnostic's first code frame.
fn location(diagnostic: &Diagnostic) -> (PathId, u32) {
  let frame = &diagnostic.code_frames[0];
  (
    frame.url.as_ref().unwrap().to_file_path().unwrap(),
    frame.code_highlights[0].start.line,
  )
}

fn project_file(file: &str) -> PathId {
  PathId::new(&Path::new("/project").join(file))
}

#[test]
fn missing_import_warns_at_the_import() {
  let diagnostics = build(
    "index.js",
    &[
      (
        "index.js",
        "import {a} from './dep.js';\nimport {b} from './other.js';\noutput = [a, b];",
      ),
      ("dep.js", "export const a = 1;"),
      ("other.js", "export const a = 1;"),
    ],
  );
  assert_eq!(messages(&diagnostics), ["other.js does not export 'b'."]);
  let diagnostic = &diagnostics[0];
  assert_eq!(diagnostic.severity, DiagnosticSeverity::Warning);
  assert_eq!(location(diagnostic), (project_file("index.js"), 2));
}

#[test]
fn missing_reexport_warns_at_the_reexport() {
  let diagnostics = build(
    "index.js",
    &[
      ("index.js", "import {a} from './barrel.js';\noutput = a;"),
      ("barrel.js", "export {a} from './dep.js';"),
      ("dep.js", "export const b = 1;"),
    ],
  );
  assert_eq!(messages(&diagnostics), ["dep.js does not export 'a'."]);
  assert_eq!(location(&diagnostics[0]), (project_file("barrel.js"), 1));
}

#[test]
fn star_reexports_warn_only_if_none_provides_the_name() {
  // Names that `export *` of a module with side effects doesn't provide resolve at runtime, so
  // only side-effect-free re-exports are checked.
  let files = [
    ("package.json", r#"{"sideEffects": ["index.js"]}"#),
    (
      "barrel.js",
      "export * from './a.js';\nexport * from './b.js';",
    ),
    ("a.js", "export const a = 1;"),
    ("b.js", "export const b = 1;"),
  ];
  let found = [
    &files[..],
    &[("index.js", "import {b} from './barrel.js';\noutput = b;")],
  ]
  .concat();
  assert_eq!(messages(&build("index.js", &found)), Vec::<&str>::new());

  let missing = [
    &files[..],
    &[("index.js", "import {c} from './barrel.js';\noutput = c;")],
  ]
  .concat();
  let diagnostics = build("index.js", &missing);
  assert_eq!(messages(&diagnostics), ["barrel.js does not export 'c'."]);
  assert_eq!(location(&diagnostics[0]), (project_file("index.js"), 1));
}

#[test]
fn missing_css_module_class_warns() {
  let diagnostics = build(
    "index.js",
    &[
      (
        "index.js",
        "import {a, b} from './style.module.css';\noutput = [a, b];",
      ),
      ("style.module.css", ".a { color: red }"),
    ],
  );
  assert_eq!(
    messages(&diagnostics),
    ["style.module.css does not export 'b'."]
  );
}

#[test]
fn missing_fragment_id_warns_at_the_reference() {
  let html =
    "<svg><use href=\"sprite.svg#home\"/></svg>\n<svg><use href=\"sprite.svg#hom\"/></svg>\n";
  let diagnostics = build(
    "index.html",
    &[("index.html", html), ("sprite.svg", SPRITE)],
  );
  assert_eq!(
    messages(&diagnostics),
    ["sprite.svg does not export 'hom'."]
  );
  assert_eq!(location(&diagnostics[0]), (project_file("index.html"), 2));
}

#[test]
fn missing_fragment_id_warns_from_css() {
  let html = "<link rel=\"stylesheet\" href=\"style.css\"><div class=\"a\"></div>";
  let css = ".a { mask: url(sprite.svg#missing) }";
  let diagnostics = build(
    "index.html",
    &[
      ("index.html", html),
      ("style.css", css),
      ("sprite.svg", SPRITE),
    ],
  );
  assert_eq!(
    messages(&diagnostics),
    ["sprite.svg does not export 'missing'."]
  );
}

#[test]
fn view_specifications_and_scripted_svgs_do_not_warn() {
  let scripted = r#"<svg xmlns="http://www.w3.org/2000/svg"><script>document.documentElement.append(document.createElementNS('http://www.w3.org/2000/svg', 'symbol'))</script></svg>"#;
  let html = "<img src=\"sprite.svg#svgView(viewBox(0,0,1,1))\"><svg><use href=\"scripted.svg#dynamic\"/></svg>";
  let diagnostics = build(
    "index.html",
    &[
      ("index.html", html),
      ("sprite.svg", SPRITE),
      ("scripted.svg", scripted),
    ],
  );
  assert_eq!(messages(&diagnostics), Vec::<&str>::new());
}

#[test]
fn module_interop_does_not_warn() {
  let index = "
    import cjs from './cjs.js';
    import style from './style.module.css';
    import sprite from './sprite.svg';
    import url from 'url:./esm.js';
    const esm = require('./esm.js');
    const fs = require('fs');
    output = [cjs, style, sprite, url, esm.__esModule, fs.readFileSync];
  ";
  let diagnostics = build(
    "index.js",
    &[
      ("index.js", index),
      ("cjs.js", "exports.a = 1;"),
      ("esm.js", "export const a = 1;"),
      ("style.module.css", ".a { color: red }"),
      ("sprite.svg", SPRITE),
      (
        "package.json",
        r#"{"browser": {"fs": false}, "sideEffects": false}"#,
      ),
    ],
  );
  assert_eq!(messages(&diagnostics), Vec::<&str>::new());
}
