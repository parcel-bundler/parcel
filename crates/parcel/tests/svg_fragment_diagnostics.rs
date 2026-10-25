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
        if diagnostic.message.contains("has no element with id") {
          assert_eq!(log.level, LogLevel::Warn);
          self.0.lock().unwrap().push(diagnostic.clone());
        }
      }
    }
    Ok(())
  }
}

const SPRITE: &str = r#"<svg xmlns="http://www.w3.org/2000/svg"><symbol id="home"><path d="M0 0h1v1z"/></symbol></svg>"#;

fn build(files: &[(&str, &str)]) -> Vec<Diagnostic> {
  let input = Arc::new(MemoryFileSystem::new());
  for &(file, code) in files.iter().chain([("package.json", "{}")].iter()) {
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
    &vec!["/project/index.html".into()],
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
  .expect("missing fragment ids must not fail the build");
  warnings.0.lock().unwrap().clone()
}

#[test]
fn missing_fragment_id_warns_at_the_reference() {
  let html =
    "<svg><use href=\"sprite.svg#home\"/></svg>\n<svg><use href=\"sprite.svg#hom\"/></svg>\n";
  let diagnostics = build(&[("index.html", html), ("sprite.svg", SPRITE)]);
  assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
  let diagnostic = &diagnostics[0];
  assert_eq!(diagnostic.severity, DiagnosticSeverity::Warning);
  assert_eq!(
    diagnostic.message,
    "sprite.svg has no element with id 'hom'."
  );
  let frame = &diagnostic.code_frames[0];
  assert_eq!(
    frame.url.as_ref().unwrap().to_file_path().unwrap(),
    PathId::new(Path::new("/project/index.html"))
  );
  assert_eq!(frame.code_highlights[0].start.line, 2);
}

#[test]
fn missing_fragment_id_warns_from_css() {
  let html = "<link rel=\"stylesheet\" href=\"style.css\"><div class=\"a\"></div>";
  let css = ".a { mask: url(sprite.svg#missing) }";
  let diagnostics = build(&[
    ("index.html", html),
    ("style.css", css),
    ("sprite.svg", SPRITE),
  ]);
  assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
  assert_eq!(
    diagnostics[0].message,
    "sprite.svg has no element with id 'missing'."
  );
}

#[test]
fn view_specifications_and_scripted_svgs_do_not_warn() {
  let scripted = r#"<svg xmlns="http://www.w3.org/2000/svg"><script>document.documentElement.append(document.createElementNS('http://www.w3.org/2000/svg', 'symbol'))</script></svg>"#;
  let html = "<img src=\"sprite.svg#svgView(viewBox(0,0,1,1))\"><svg><use href=\"scripted.svg#dynamic\"/></svg>";
  let diagnostics = build(&[
    ("index.html", html),
    ("sprite.svg", SPRITE),
    ("scripted.svg", scripted),
  ]);
  assert!(diagnostics.is_empty(), "{diagnostics:#?}");
}
