#[path = "../../core/tests/support/mod.rs"]
mod test_utils;

use std::{
  cell::RefCell,
  collections::HashMap,
  path::{Path, PathBuf},
  sync::Arc,
};

use parcel_core::{
  AssetIndex, AssetType, BuildOptions, BundleBehavior, BundleFlags, BundleGraph, CodeFrame,
  CodeHighlight, Diagnostic, DiagnosticList, DiagnosticSeverity, Environment, EnvironmentFlags,
  FileSystem, MemoryFileSystem, OsFileSystem, OutputFormat, OverlayFileSystem, PathId, SourceType,
  SymbolResolution,
};
use parcel_plugin_js::{create_runtime, require_module};
use pretty_assertions::assert_eq;
use rquickjs::Function;

/// How a script is evaluated, as the page or Node would.
#[derive(Clone, Copy, PartialEq)]
enum ScriptKind {
  Module,
  /// A classic script, whose top-level declarations are globals.
  Classic,
  Commonjs,
}

impl From<OutputFormat> for ScriptKind {
  fn from(output_format: OutputFormat) -> Self {
    match output_format {
      OutputFormat::Commonjs => ScriptKind::Commonjs,
      _ => ScriptKind::Module,
    }
  }
}

fn run(
  paths: Vec<(PathBuf, ScriptKind)>,
  fs: Arc<dyn FileSystem>,
  cwd: &Path,
  environment: Environment,
  entry: Option<String>,
  is_library: bool,
) -> (serde_json::Value, Vec<serde_json::Value>) {
  let mut env = HashMap::new();
  env.insert("NODE_ENV".into(), "test".into());
  let ctx = create_runtime(fs.clone(), &env, PathId::new(cwd), environment).unwrap();
  let res = ctx.with(|ctx| {
    let globals = ctx.globals();
    let side_effects = Arc::new(RefCell::new(Vec::<serde_json::Value>::new()));
    let side_effects_clone = side_effects.clone();
    globals.set("document", rquickjs::Object::new(ctx.clone()))?;
    globals.set("output", rquickjs::Undefined).unwrap();
    globals.set("sideEffectNoop", rquickjs::Function::new(ctx.clone(), noop))?;
    globals.set(
      "sideEffect",
      rquickjs::Function::new(
        ctx.clone(),
        move |args: rquickjs::function::Rest<rquickjs::Value>| {
          let values = args
            .0
            .into_iter()
            .map(|v| rquickjs_serde::from_value(v).unwrap());
          side_effects_clone.borrow_mut().extend(values);
        },
      ),
    )?;

    let mut imported = None;
    for (path, kind) in paths {
      imported = Some(match kind {
        ScriptKind::Module => rquickjs::Module::import(&ctx, path.to_str().unwrap().to_owned())
          .and_then(|p| p.finish::<rquickjs::Value>())?,
        ScriptKind::Classic => {
          let mut options = rquickjs::context::EvalOptions::default();
          options.strict = false;
          options.filename = Some(path.to_str().unwrap().to_owned());
          ctx.eval_with_options(fs.read(PathId::new(&path)).unwrap(), options)?
        }
        ScriptKind::Commonjs => require_module(ctx, path.to_str().unwrap())?,
      });
    }
    // Settle what the scripts started, e.g. an async script waiting for its bundles to load.
    while ctx.execute_pending_job() {}

    let output: rquickjs::Result<rquickjs::Value> = if is_library {
      Ok(imported.unwrap())
    } else {
      let parcel_require: Option<Function> = ctx.globals().get("parcelRequire").ok();
      if let (Some(parcel_require), Some(entry)) = (parcel_require, entry) {
        parcel_require.call((entry,))
      } else {
        Ok(rquickjs::Value::new_undefined(ctx.clone()))
      }
    };

    let mut v = output.and_then(|v: rquickjs::Value| {
      let output: rquickjs::Value = ctx.globals().get("output")?;
      if !output.is_undefined() {
        return Ok(output);
      }
      Ok(v)
    })?;

    if v.is_function() {
      v = v.as_function().unwrap().call(())?;
    } else if let Some(default_val) = v
      .as_object()
      .and_then(|o| {
        if o.keys::<rquickjs::Value>().count() == 1 {
          o.get::<_, rquickjs::Value>("default").ok()
        } else {
          None
        }
      })
      .filter(|v| !v.is_undefined())
    {
      if default_val.is_function() {
        v = default_val.as_function().unwrap().call(())?;
      } else {
        v = default_val;
      }
    }

    if v.is_promise() {
      v = v.as_promise().unwrap().finish()?;
    }
    let ctx = v.ctx().clone();
    let out: serde_json::Value = match rquickjs_serde::from_value(v) {
      Ok(v) => v,
      Err(e) => {
        panic!("{:?}", e.catch(&ctx));
      }
    };

    Ok((out, side_effects.borrow().clone()))
  });

  if let Err(err) = res {
    panic!("{:?}", err);
  }

  res.unwrap()
}

fn noop<'js>(value: rquickjs::Value<'js>) -> rquickjs::Value<'js> {
  value
}

fn bundle_with_options(
  cwd: &Path,
  entries: Vec<String>,
  output_fs: Arc<dyn FileSystem>,
  options: TestOptions,
) -> Result<BundleGraph<'static>, DiagnosticList> {
  let mut env = options.env;
  if !env.contains_key("NODE_ENV") {
    env.insert("NODE_ENV".into(), "test".into());
  }
  let options = BuildOptions {
    mode: options.mode,
    optimize: options.minify,
    content_hash: options.content_hash.or_else(|| {
      std::env::var("PARCEL_TEST_CONTENT_HASH")
        .is_ok()
        .then_some(true)
    }),
    source_map: Some(Default::default()),
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: output_fs.clone(),
    log_level: parcel_core::LogLevel::Verbose,
    config: options.config,
    cwd: PathId::new(cwd),
    dist_dir: None,
    public_url: options.public_url,
    hmr: options.hmr.then(|| parcel_core::HmrOptions {
      host: "localhost".into(),
      port: 1234,
    }),
    reporters: Vec::new(),
  };

  parcel::build(&entries, options)
}

fn run_test_with_options(fixture_dir: &Path, entries: Vec<String>, test: TestJson) {
  let output_fs = Arc::new(OverlayFileSystem::new());
  let cwd = test
    .options
    .cwd
    .as_ref()
    .map(|cwd| fixture_dir.join(cwd))
    .unwrap_or_else(|| fixture_dir.to_path_buf());
  let bundle_graph = bundle_with_options(&cwd, entries, output_fs.clone(), test.options).unwrap();
  if let Some(mut expected) = test.internalized {
    let mut actual = Vec::new();
    for (source, asset, _) in bundle_graph.asset_graph.dfs() {
      for dependency in 0..asset.dependencies.len() {
        if let parcel_core::BundleGraphDependencyResolution::Internalized(target) =
          bundle_graph.dependency_resolution(source, dependency)
        {
          let name = |index| {
            bundle_graph
              .asset_graph
              .asset(index)
              .loc
              .url
              .to_file_path()
              .unwrap()
              .file_name()
              .to_string()
          };
          actual.push((name(source), name(target)));
        }
      }
    }
    actual.sort();
    expected.sort();
    assert_eq!(
      actual, expected,
      "Internalized dependencies (source, target)"
    );
  }

  let mut scripts = Vec::new();
  let mut main = None;

  if !test.bundles.is_empty() {
    let asset_names = |bundle: &parcel_core::Bundle| {
      let mut names: Vec<String> = bundle
        .assets
        .iter()
        .filter_map(|a| {
          let path = bundle_graph
            .asset_graph
            .asset(*a)
            .loc
            .url
            .to_file_path()
            .ok()?;
          // Parcel's embedded runtime modules are located in the project's node_modules.
          let buf = path.to_path_buf();
          if test.skip_node_modules
            && (!buf.starts_with(fixture_dir)
              || buf.starts_with(fixture_dir.join("node_modules/@parcel/parcel3")))
          {
            return None;
          }
          Some(path.file_name().to_string())
        })
        .collect();
      names.sort_unstable();
      names
    };
    let actual_assets: Vec<_> = bundle_graph.bundles.iter().map(asset_names).collect();
    assert_eq!(
      test.bundles.len(),
      bundle_graph.bundles.len(),
      "Expected number of bundles did not match. Actual bundles: {actual_assets:#?}"
    );
    for (bundle, names) in bundle_graph.bundles.iter().zip(&actual_assets) {
      let found = test.bundles.iter().find(|b| {
        &b.assets == names
          && (b.ty.is_none() || b.ty.as_ref().unwrap() == &bundle.ty)
          && (b.environment.is_none()
            || b.environment.as_ref().unwrap() == &bundle.target.environment)
          && b
            .output_format
            .is_none_or(|format| format == bundle.target.output_format)
          && (b.name.is_none()
            || Path::new(b.name.as_ref().unwrap())
              == bundle.dist_path().relative(&bundle.target.dist_dir))
          && b
            .dist_dir
            .as_ref()
            .is_none_or(|dir| fixture_dir.join(dir) == bundle.target.dist_dir.to_path_buf())
      });
      assert!(
        found.is_some(),
        "Could not find bundle with expected assets. Actual assets: {:?}, name: {:?}. All bundles: {actual_assets:#?}",
        names,
        bundle.dist_path
      );
      let found = found.unwrap();
      if let Some(expected) = &found.references {
        let mut actual: Vec<_> = bundle
          .referenced_bundles
          .iter()
          .map(|&index| actual_assets[index].clone())
          .collect();
        actual.sort();
        assert_eq!(&actual, expected, "Referenced bundles for {names:?}");
      }
      if let Some(prefix) = &found.starts_with {
        let contents = output_fs.read_to_string(bundle.dist_path()).unwrap();
        assert!(
          contents.starts_with(prefix.as_str()),
          "Bundle {:?} did not start with {:?}\n\nBundle contents: {}",
          bundle.dist_path(),
          prefix,
          contents
        );
      }
      if !found.contains.is_empty() {
        let contents = output_fs.read_to_string(bundle.dist_path()).unwrap();
        for substring in &found.contains {
          let substring = expand_bundle_urls(substring, &bundle_graph);
          assert!(
            contents.contains(&substring),
            "Bundle {:?} did not contain expected substring {:?}\n\nBundle contents: {}",
            bundle.dist_path(),
            substring,
            contents
          );
        }
      }
      if !found.not_contains.is_empty() {
        let contents = output_fs.read_to_string(bundle.dist_path()).unwrap();
        for substring in &found.not_contains {
          assert!(
            !contents.contains(substring),
            "Bundle {:?} contained unexpected substring {:?}\n\nBundle contents: {}",
            bundle.dist_path(),
            substring,
            contents
          );
        }
      }
    }
  }

  let should_run = test.output.is_some() || !test.side_effects.is_empty();
  let mut env = Environment::Browser;
  if should_run {
    for bundle in &bundle_graph.bundles {
      if !bundle.flags.contains(BundleFlags::ENTRY)
        || bundle.bundle_behavior == BundleBehavior::Inline
      {
        continue;
      }

      let is_library = bundle.target.flags.contains(EnvironmentFlags::IS_LIBRARY);
      let path = bundle.dist_path();
      match &bundle.ty {
        AssetType::Js => {
          if is_library {
            let (output, side_effects) = run(
              vec![(path.to_path_buf(), bundle.target.output_format.into())],
              output_fs.clone(),
              &cwd,
              Environment::Node,
              Some(
                bundle_graph
                  .asset_graph
                  .asset(bundle.main_entry_asset.unwrap())
                  .id(&bundle_graph.project_root),
              ),
              true,
            );
            assert_eq!(side_effects, test.side_effects);
            if let Some(expected_output) = &test.output {
              assert_eq!(&output, expected_output);
            }
          } else {
            if scripts.is_empty() {
              if let Some(m) = bundle.main_entry_asset {
                main = Some(
                  bundle_graph
                    .asset_graph
                    .asset(m)
                    .id(&bundle_graph.project_root),
                );
              }
            }
            scripts.push((path.to_path_buf(), script_kind(bundle)));
            env = bundle.target.environment;
          }
        }
        AssetType::Html => {
          // Give the runtime the page's manifest data blocks, as a browser's DOM would.
          let html = output_fs.read_to_string(path).unwrap();
          let page_scripts = page_scripts(&html);
          let manifests: Vec<&str> = page_scripts
            .iter()
            .filter(|script| script.is_manifest)
            .map(|script| script.code)
            .collect();
          if !manifests.is_empty() {
            let blocks = manifests
              .iter()
              .map(|json| format!("{{textContent:{}}}", serde_json::to_string(json).unwrap()))
              .collect::<Vec<_>>()
              .join(",");
            let setup = format!(
              "document.querySelectorAll = selector => selector.includes('data-parcel-manifest') ? [{blocks}] : [];"
            );
            let setup_path = path.with_extension("manifest.js");
            output_fs.write(setup_path, setup.as_bytes()).unwrap();
            scripts.push((setup_path.to_path_buf(), ScriptKind::Classic));
          }

          // Async scripts may run as soon as they load, before the page's other scripts. Run them
          // first to check they don't depend on those.
          let first_script = scripts.len();
          let mut async_scripts = 0;
          for (index, script) in page_scripts
            .into_iter()
            .filter(|script| !script.is_manifest)
            .enumerate()
          {
            let is_async = script.is_module && script.is_async;
            let script = match script.src {
              Some(src) => {
                // Pages reference bundles by absolute URLs unless the public URL is relative.
                let resolved = match src.strip_prefix('/') {
                  Some(name) => bundle.target.dist_dir.join(Path::new(name)),
                  None => path.parent().unwrap().join(Path::new(src)),
                };
                let b = bundle_graph
                  .bundles
                  .iter()
                  .find(|b| b.dist_path() == resolved)
                  .unwrap();
                let kind = script_kind(b);
                // A classic script runs on load rather than from the module table.
                if let Some(m) = b.main_entry_asset
                  && kind != ScriptKind::Classic
                {
                  main = Some(
                    bundle_graph
                      .asset_graph
                      .asset(m)
                      .id(&bundle_graph.project_root),
                  );
                }
                (resolved.to_path_buf(), kind)
              }
              None => {
                let inline_path = path.with_extension(&format!("inline{index}.js"));
                output_fs
                  .write(inline_path, script.code.as_bytes())
                  .unwrap();
                let kind = if script.is_module {
                  ScriptKind::Module
                } else {
                  ScriptKind::Classic
                };
                (inline_path.to_path_buf(), kind)
              }
            };

            if is_async {
              scripts.insert(first_script + async_scripts, script);
              async_scripts += 1;
            } else {
              scripts.push(script);
            }
          }
        }
        _ => {}
      }
    }

    if !scripts.is_empty() {
      let (output, side_effects) = run(scripts, output_fs.clone(), &cwd, env, main, false);
      assert_eq!(side_effects, test.side_effects);
      if let Some(expected_output) = &test.output {
        assert_eq!(&output, expected_output);
      }
    }
  }

  let expected = fixture_dir.join("expected");
  let update_snapshots = std::env::var("UPDATE_SNAPSHOTS").is_ok();

  if expected.is_dir() {
    for entry in expected.read_dir().unwrap() {
      let entry = entry.unwrap();
      let expected_bytes = std::fs::read(entry.path()).unwrap();
      let ty = AssetType::from_extension(entry.path().extension().unwrap().to_str().unwrap());
      let bundle = bundle_graph
        .bundles
        .iter()
        .find(|b| {
          if b.ty != ty {
            return false;
          }
          let name = b
            .assets
            .iter()
            .map(|a| {
              bundle_graph
                .asset_graph
                .asset(*a)
                .loc
                .url
                .to_file_path()
                .unwrap()
                .file_prefix()
                .unwrap()
                .to_string()
            })
            .collect::<Vec<_>>()
            .join("_");
          name == entry.path().file_prefix().unwrap().to_str().unwrap()
        })
        .unwrap_or_else(|| {
          let names: Vec<String> = bundle_graph
            .bundles
            .iter()
            .map(|bundle| {
              bundle
                .assets
                .iter()
                .map(|a| {
                  bundle_graph
                    .asset_graph
                    .asset(*a)
                    .loc
                    .url
                    .to_file_path()
                    .unwrap()
                    .file_prefix()
                    .unwrap()
                    .to_string()
                })
                .collect::<Vec<_>>()
                .join("_")
            })
            .collect();
          panic!(
            "could not find bundle for expected file {:?}; bundle names: {:?}",
            entry.file_name(),
            names
          )
        });

      if update_snapshots {
        let bytes = output_fs.read(bundle.dist_path()).unwrap();
        std::fs::write(entry.path(), bytes).unwrap();
        eprintln!("Wrote snapshot: {:?}", entry.path());
      } else if bundle.ty.is_binary() {
        let actual_bytes = output_fs.read(bundle.dist_path()).unwrap();
        assert_eq!(actual_bytes, expected_bytes, "{:?}", entry.file_name());
      } else {
        let actual_content = output_fs.read_to_string(bundle.dist_path()).unwrap();
        assert_eq!(
          actual_content,
          std::str::from_utf8(&expected_bytes).unwrap(),
          "{:?}",
          entry.file_name()
        );
      }
    }
  }
}

fn script_kind(bundle: &parcel_core::Bundle) -> ScriptKind {
  if bundle.target.source_type == SourceType::Script {
    ScriptKind::Classic
  } else {
    bundle.target.output_format.into()
  }
}

/// A `<script>` a page runs, in document order.
struct PageScript<'a> {
  src: Option<&'a str>,
  is_module: bool,
  is_async: bool,
  /// A JSON data block holding the page's manifest, which the runtime reads rather than runs.
  is_manifest: bool,
  code: &'a str,
}

/// The JavaScript `<script>` tags in `html` that a browser supporting modules would run, except
/// remote ones, and the page's manifest data blocks.
fn page_scripts(html: &str) -> Vec<PageScript<'_>> {
  let mut scripts = Vec::new();
  let mut rest = html;
  while let Some(start) = rest.find("<script") {
    rest = &rest[start + "<script".len()..];
    let tag_end = rest.find('>').unwrap();
    let attributes: Vec<(&str, Option<&str>)> = rest[..tag_end]
      .split_ascii_whitespace()
      .map(|attribute| match attribute.split_once('=') {
        Some((name, value)) => (name, Some(value.trim_matches(['"', '\''].as_ref()))),
        None => (attribute, None),
      })
      .collect();
    let body = &rest[tag_end + 1..];
    let body_end = body.find("</script>").unwrap();
    rest = &body[body_end..];

    let attribute = |name| attributes.iter().find(|(n, _)| *n == name);
    let ty = attribute("type").and_then(|(_, value)| *value);
    let src = attribute("src").and_then(|(_, value)| *value);
    // The attribute is `data-parcel-manifest=""`, or bare once the HTML is minified.
    let is_manifest = attribute("data-parcel-manifest").is_some();
    if !is_manifest && !matches!(ty, None | Some("module" | "text/javascript"))
      || attribute("nomodule").is_some()
      || src.is_some_and(|src| src.contains("//"))
    {
      continue;
    }
    scripts.push(PageScript {
      src,
      is_module: ty == Some("module"),
      is_async: attribute("async").is_some(),
      is_manifest,
      code: &body[..body_end],
    });
  }
  scripts
}

/// Resolve {{bundle:asset-name}} to the emitted public URL, so fixtures can
/// assert references without hard-coding generated bundle names.
fn expand_bundle_urls(pattern: &str, graph: &BundleGraph) -> String {
  let mut result = String::new();
  let mut remaining = pattern;
  while let Some(start) = remaining.find("{{bundle:") {
    result.push_str(&remaining[..start]);
    let reference = &remaining[start + "{{bundle:".len()..];
    let end = reference
      .find("}}")
      .expect("Unterminated bundle URL assertion");
    let name = &reference[..end];
    let matches: Vec<_> = graph
      .bundles
      .iter()
      .filter(|bundle| {
        bundle.assets.iter().any(|asset| {
          graph
            .asset_graph
            .asset(*asset)
            .loc
            .url
            .to_file_path()
            .is_ok_and(|path| path.file_name() == name)
        })
      })
      .collect();
    assert_eq!(
      matches.len(),
      1,
      "Expected one bundle for URL assertion {name}"
    );
    result.push_str(&matches[0].absolute_url());
    remaining = &reference[end + 2..];
  }
  result.push_str(remaining);
  result
}

fn deserialize_input<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
  use serde::de::{self, Visitor};
  struct InputVisitor;
  impl<'de> Visitor<'de> for InputVisitor {
    type Value = Vec<String>;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
      f.write_str("string or array of strings")
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
      Ok(vec![v.to_owned()])
    }
    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
      let mut v = Vec::new();
      while let Some(s) = seq.next_element()? {
        v.push(s);
      }
      Ok(v)
    }
  }
  d.deserialize_any(InputVisitor)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestJson {
  /// Exact (source filename, target filename) pairs for internalized imports.
  internalized: Option<Vec<(String, String)>>,
  #[serde(default)]
  description: String,
  #[serde(deserialize_with = "deserialize_input")]
  input: Vec<String>,
  #[serde(default)]
  options: TestOptions,
  output: Option<serde_json::Value>,
  #[serde(default)]
  side_effects: Vec<serde_json::Value>,
  #[serde(default)]
  bundles: Vec<TestBundle>,
  #[serde(default)]
  diagnostics: Vec<Diagnostic>,
  /// Match only assets located in the fixture directory, like JS `assertBundles`'s
  /// `skipNodeModules` option. Parcel's embedded runtime modules are skipped too.
  #[serde(default)]
  skip_node_modules: bool,
}

fn assert_diagnostics(actual: &DiagnosticList, expected: &[Diagnostic]) {
  assert_eq!(
    actual.0.len(),
    expected.len(),
    "Expected {} diagnostic(s) but got {}: {:#?}",
    expected.len(),
    actual.0.len(),
    actual.0
  );
  for (actual_diag, expected_diag) in actual.0.iter().zip(expected.iter()) {
    assert_diagnostic_matches(actual_diag, expected_diag);
  }
}

fn assert_diagnostic_matches(actual: &Diagnostic, expected: &Diagnostic) {
  if !expected.message.is_empty() {
    assert!(
      actual.message.contains(&expected.message),
      "Expected diagnostic message to contain {:?}, got {:?}",
      expected.message,
      actual.message
    );
  }
  if let Some(origin) = &expected.origin {
    assert_eq!(
      actual.origin.as_deref(),
      Some(origin.as_str()),
      "Diagnostic origin mismatch"
    );
  }
  if !expected.code_frames.is_empty() {
    assert_eq!(
      actual.code_frames.len(),
      expected.code_frames.len(),
      "Code frame count mismatch"
    );
    for (actual_frame, expected_frame) in actual.code_frames.iter().zip(expected.code_frames.iter())
    {
      assert_code_frame_matches(actual_frame, expected_frame);
    }
  }
  if !expected.hints.is_empty() {
    assert_eq!(actual.hints, expected.hints, "Hints mismatch");
  }
  if expected.severity != DiagnosticSeverity::default() {
    assert_eq!(actual.severity, expected.severity, "Severity mismatch");
  }
}

fn assert_code_frame_matches(actual: &CodeFrame, expected: &CodeFrame) {
  if !expected.code_highlights.is_empty() {
    assert_eq!(
      actual.code_highlights.len(),
      expected.code_highlights.len(),
      "Code highlight count mismatch"
    );
    for (actual_hl, expected_hl) in actual
      .code_highlights
      .iter()
      .zip(expected.code_highlights.iter())
    {
      assert_code_highlight_matches(actual_hl, expected_hl);
    }
  }
}

fn assert_code_highlight_matches(actual: &CodeHighlight, expected: &CodeHighlight) {
  if let Some(msg) = &expected.message {
    assert_eq!(
      actual.message.as_deref(),
      Some(msg.as_str()),
      "Code highlight message mismatch"
    );
  }
  if expected.start.line != 0 {
    assert_eq!(
      actual.start.line, expected.start.line,
      "Start line mismatch"
    );
  }
  if expected.start.column != 0 {
    assert_eq!(
      actual.start.column, expected.start.column,
      "Start column mismatch"
    );
  }
  if expected.end.line != 0 {
    assert_eq!(actual.end.line, expected.end.line, "End line mismatch");
  }
  if expected.end.column != 0 {
    assert_eq!(
      actual.end.column, expected.end.column,
      "End column mismatch"
    );
  }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestBundle {
  name: Option<String>,
  /// The target's dist directory, relative to the fixture directory.
  dist_dir: Option<String>,
  #[serde(alias = "context")]
  environment: Option<Environment>,
  #[serde(default)]
  assets: Vec<String>,
  #[serde(rename = "type")]
  ty: Option<AssetType>,
  #[serde(rename = "outputFormat")]
  output_format: Option<OutputFormat>,
  #[serde(default)]
  /// Substrings may use {{bundle:asset-name}} for generated public URLs.
  contains: Vec<String>,
  #[serde(default)]
  not_contains: Vec<String>,
  starts_with: Option<String>,
  /// Asset lists of directly referenced bundles, independent of hashed filenames.
  references: Option<Vec<Vec<String>>>,
}

#[derive(serde::Deserialize, Default)]
struct TestOptions {
  #[serde(default)]
  mode: parcel_core::BuildMode,
  minify: Option<bool>,
  /// Whether bundle names include a content hash. Defaults to on in production mode.
  #[serde(rename = "contentHash")]
  content_hash: Option<bool>,
  #[serde(default, rename = "publicUrl")]
  public_url: String,
  #[serde(default)]
  env: HashMap<String, String>,
  cwd: Option<String>,
  config: Option<String>,
  /// Whether to build for HMR (without starting a server).
  #[serde(default)]
  hmr: bool,
}

fn run_test_json(path: &Path) {
  let test: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
  if let serde_json::Value::Array(tests) = test {
    for test in tests {
      run_test_json_test(path, test);
    }
  } else {
    run_test_json_test(path, test);
  }
}

fn run_test_json_test(path: &Path, test: serde_json::Value) {
  let mut test: TestJson = serde_json::from_value(test).unwrap();
  eprintln!("Description: {}", test.description);

  for bundle in &mut test.bundles {
    bundle.assets.sort();
    if let Some(references) = &mut bundle.references {
      for assets in references.iter_mut() {
        assets.sort();
      }
      references.sort();
    }
  }

  let fixture_dir = path.parent().unwrap();
  if !test.diagnostics.is_empty() {
    let output_fs = Arc::new(MemoryFileSystem::new());
    match bundle_with_options(fixture_dir, test.input, output_fs, test.options) {
      Err(actual) => assert_diagnostics(&actual, &test.diagnostics),
      Ok(_) => panic!("Expected build to fail with diagnostics but it succeeded"),
    }
    return;
  }

  run_test_with_options(fixture_dir, test.input.clone(), test);
}

// #[testing_macros::fixture("../../packages/core/integration-tests/test/integration/**/test.json")]
#[testing_macros::fixture("../../crates/parcel/tests/fixtures/**/test.json")]
fn test(file: PathBuf) {
  run_test_json(&file);
}

#[test]
fn json_url_content_packages_final_bundle_urls() {
  for fixture in [
    "webmanifest/webmanifest",
    "webmanifest/webmanifest-json",
    "jsonld/schema-jsonld",
  ] {
    let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
      .join("tests/fixtures")
      .join(fixture);
    for mode in [
      parcel_core::BuildMode::Development,
      parcel_core::BuildMode::Production,
    ] {
      let output_fs = Arc::new(MemoryFileSystem::new());
      let graph = bundle_with_options(
        &fixture_dir,
        vec!["index.html".into()],
        output_fs.clone(),
        TestOptions {
          mode,
          public_url: "https://place.holder/assets/".into(),
          ..Default::default()
        },
      )
      .unwrap();
      let url_for = |name: &str| {
        graph
          .bundles
          .iter()
          .find(|bundle| {
            bundle.assets.iter().any(|&index| {
              graph
                .asset_graph
                .asset(index)
                .loc
                .url
                .to_file_path()
                .unwrap()
                .file_name()
                == name
            })
          })
          .unwrap()
          .absolute_url()
      };
      let json_bundle = graph
        .bundles
        .iter()
        .find(|bundle| matches!(bundle.ty.extension(), "webmanifest" | "jsonld"))
        .unwrap();
      // Packaging must leave the parsed source intact so the content can be reused.
      let original: serde_json::Value = serde_json::from_slice(
        &graph
          .asset_graph
          .asset(json_bundle.assets[0])
          .content
          .read()
          .unwrap(),
      )
      .unwrap();
      if json_bundle.ty == AssetType::Jsonld {
        let html_bundle = graph
          .bundles
          .iter()
          .find(|bundle| bundle.ty == AssetType::Html)
          .unwrap();
        let html = output_fs.read_to_string(html_bundle.dist_path()).unwrap();
        let script = html.split("application/ld+json").nth(1).unwrap();
        let json = script
          .split_once('>')
          .unwrap()
          .1
          .split("</script>")
          .next()
          .unwrap();
        let json: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(json["logo"]["url"], url_for("logo.png"));
        assert_eq!(
          json["image"],
          serde_json::json!([url_for("image.jpeg"), url_for("image.jpeg")])
        );
        assert_eq!(json["@context"], original["@context"]);
        assert_eq!(original["logo"]["url"], "images/logo.png");
      } else {
        let json: serde_json::Value =
          serde_json::from_slice(&output_fs.read(json_bundle.dist_path()).unwrap()).unwrap();
        for (pointer, name) in [
          ("/icons/0/src", "icon.png"),
          ("/screenshots/0/src", "screenshot.png"),
          ("/shortcuts/0/icons/0/src", "shortcut-icon.png"),
          ("/file_handlers/0/icons/0/src", "file-handler-icon.png"),
        ] {
          assert_eq!(
            json.pointer(pointer).unwrap(),
            &serde_json::Value::String(url_for(name))
          );
          assert_eq!(original.pointer(pointer).unwrap(), name);
        }
        assert_eq!(json["name"], original["name"]);
      }
    }
  }
}

#[test]
fn internalization_entry_facades_run_independently() {
  assert_entry_outputs_run_independently(
    "internalization-entry-cycle",
    true,
    &[
      parcel_core::BuildMode::Development,
      parcel_core::BuildMode::Production,
    ],
  );
}

#[test]
fn merged_entry_outputs_run_independently() {
  assert_entry_outputs_run_independently(
    "merge-entry-cycle",
    false,
    &[parcel_core::BuildMode::Production],
  );
}

fn assert_entry_outputs_run_independently(
  fixture: &str,
  expect_facades: bool,
  modes: &[parcel_core::BuildMode],
) {
  let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
    .join("tests/fixtures/bundler")
    .join(fixture);
  for mode in modes.iter().cloned() {
    let output_fs = Arc::new(OverlayFileSystem::new());
    let graph = bundle_with_options(
      &fixture_dir,
      vec!["a.js".into(), "b.js".into()],
      output_fs.clone(),
      TestOptions {
        mode,
        config: Some(".parcelrc".into()),
        ..Default::default()
      },
    )
    .unwrap();
    for entry in graph
      .bundles
      .iter()
      .filter(|b| b.flags.contains(BundleFlags::ENTRY))
    {
      assert_eq!(entry.assets.is_empty(), expect_facades);
      // Each call creates a fresh runtime and loads just this one entry file.
      let (output, effects) = run(
        vec![(
          entry.dist_path().to_path_buf(),
          entry.target.output_format.into(),
        )],
        output_fs.clone(),
        &fixture_dir,
        entry.target.environment,
        Some(
          graph
            .asset_graph
            .asset(entry.main_entry_asset.unwrap())
            .id(&graph.project_root),
        ),
        false,
      );
      assert_eq!(output, serde_json::json!(["a", "b"]));
      assert_eq!(
        effects,
        vec![serde_json::json!("entry"), serde_json::json!("entry")]
      );
    }
  }
}

/// GetExportedNames: local exports must shadow `export *`, and a name provided by two
/// different `export *` sources is ambiguous.
#[test]
fn get_exports_star_dedupe() {
  let fixture_dir =
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/react-server/client-star-exports");
  let output_fs = Arc::new(MemoryFileSystem::new());
  let bundle_graph = bundle_with_options(
    &fixture_dir,
    vec!["index.jsx".into()],
    output_fs,
    TestOptions::default(),
  )
  .unwrap();

  let find = |file_name: &str| -> AssetIndex {
    AssetIndex::from_index(
      bundle_graph
        .asset_graph
        .assets
        .iter()
        .position(|asset| {
          asset
            .loc
            .url
            .to_file_path()
            .is_ok_and(|path| path.file_name().to_string() == file_name)
        })
        .unwrap_or_else(|| panic!("could not find asset {file_name}")),
    )
  };

  let client_index = find("client.jsx");
  let extras_index = find("extras.js");

  // Across an environment boundary each name must appear exactly once,
  // with the local export winning over `export *`.
  let exports = bundle_graph
    .asset_graph
    .get_exports(client_index, Environment::ReactServer);
  for name in ["Client", "Extra", "Both", "Extra2"] {
    assert_eq!(
      exports.iter().filter(|(n, _)| n.as_str() == name).count(),
      1,
      "expected exactly one export named {name}: {exports:?}"
    );
  }
  let client = &exports
    .iter()
    .find(|(n, _)| n.as_str() == "Client")
    .unwrap()
    .1;
  assert!(
    matches!(client, SymbolResolution::Export { asset_index, .. } if *asset_index == client_index),
    "local export must win over export *: {client:?}"
  );

  // Without a boundary, star resolutions are not wrapped: the local export still wins,
  // a name from a single star source resolves to that source, and a name provided by
  // two different star sources is ambiguous.
  let exports = bundle_graph
    .asset_graph
    .get_exports(client_index, Environment::ReactClient);
  let client = &exports
    .iter()
    .find(|(n, _)| n.as_str() == "Client")
    .unwrap()
    .1;
  assert!(
    matches!(client, SymbolResolution::Export { asset_index, .. } if *asset_index == client_index),
    "local export must win over export *: {client:?}"
  );
  let extra = &exports
    .iter()
    .find(|(n, _)| n.as_str() == "Extra")
    .unwrap()
    .1;
  assert!(
    matches!(extra, SymbolResolution::Export { asset_index, .. } if *asset_index == extras_index),
    "star export must resolve to its source: {extra:?}"
  );
  let both = &exports
    .iter()
    .find(|(n, _)| n.as_str() == "Both")
    .unwrap()
    .1;
  assert_eq!(*both, SymbolResolution::Ambiguous);
}

/// A file system holding `files`, for builds that must not see the repository's own node_modules.
fn memory_fs(files: &[(&str, &str)]) -> Arc<MemoryFileSystem> {
  let fs = Arc::new(MemoryFileSystem::new());
  for (path, contents) in files {
    let path = test_utils::path(path);
    fs.create_dir_all(PathId::new(path.parent().unwrap()))
      .unwrap();
    fs.write(PathId::new(&path), &contents.as_bytes().to_vec())
      .unwrap();
  }
  fs
}

/// Options for a development build in `input_fs` from `cwd`.
fn memory_build_options(input_fs: Arc<MemoryFileSystem>, cwd: &str) -> BuildOptions {
  BuildOptions {
    mode: parcel_core::BuildMode::Development,
    optimize: None,
    content_hash: None,
    source_map: None,
    env: HashMap::from([("NODE_ENV".into(), "test".into())]),
    input_fs,
    output_fs: Arc::new(MemoryFileSystem::new()),
    log_level: parcel_core::LogLevel::Error,
    config: None,
    cwd: PathId::new(&test_utils::path(cwd)),
    dist_dir: None,
    public_url: Default::default(),
    hmr: None,
    reporters: Vec::new(),
  }
}

/// The asset in `graph` whose file is named `file_name`.
fn find_asset<'a>(graph: &'a BundleGraph, file_name: &str) -> Option<&'a parcel_core::Asset> {
  graph.bundles.iter().find_map(|bundle| {
    bundle.assets.iter().find_map(|&index| {
      let asset = graph.asset_graph.asset(index);
      (asset.loc.url.to_file_path().ok()?.file_name() == file_name).then_some(asset)
    })
  })
}

/// The path of the asset in `graph` whose file is named `file_name`.
fn asset_path(graph: &BundleGraph, file_name: &str) -> Option<PathBuf> {
  Some(
    find_asset(graph, file_name)?
      .loc
      .url
      .to_file_path()
      .ok()?
      .to_path_buf(),
  )
}

#[test]
fn parcel_runtime_modules_are_embedded() {
  // The project does not depend on Parcel, as when it is installed globally or run through npx.
  let input_fs = memory_fs(&[
    ("/project/package.json", r#"{"name": "project"}"#),
    (
      "/project/index.js",
      "import {a} from './a.js';\nconsole.log(a);\n",
    ),
    ("/project/a.js", "export const a = 1;\n"),
  ]);

  let graph = parcel::build(
    &vec!["index.js".into()],
    memory_build_options(input_fs, "/project"),
  )
  .unwrap();
  // Located where a local install would put them, though nothing is there.
  assert_eq!(
    asset_path(&graph, "esmodule-helpers.js"),
    Some(test_utils::path(
      "/project/node_modules/@parcel/parcel3/src/esmodule-helpers.js"
    ))
  );
}

#[test]
fn parcel_runtime_module_ids_do_not_depend_on_project_location() {
  let build = |root: &str| {
    let input_fs = memory_fs(&[
      (&format!("{root}/package.json"), r#"{"name": "project"}"#),
      (
        &format!("{root}/index.js"),
        "import {a} from './a.js';\nconsole.log(a);\n",
      ),
      (&format!("{root}/a.js"), "export const a = 1;\n"),
    ]);
    let graph = parcel::build(
      &vec!["index.js".into()],
      memory_build_options(input_fs, root),
    )
    .unwrap();
    let id = find_asset(&graph, "esmodule-helpers.js")
      .unwrap()
      .id(&graph.project_root);
    let names: Vec<_> = graph
      .bundles
      .iter()
      .map(|bundle| bundle.dist_path().relative(&bundle.target.dist_dir))
      .collect();
    (id, names)
  };

  assert_eq!(build("/project"), build("/home/someone/elsewhere"));
}

#[test]
fn mdx_components_import_the_projects_react() {
  let input_fs = memory_fs(&[
    (
      "/project/package.json",
      r#"{"name": "project", "dependencies": {"react": "^19"}}"#,
    ),
    ("/project/index.mdx", "```js\nlet x = 1;\n```\n"),
    (
      "/project/node_modules/react/package.json",
      r#"{"name": "react", "version": "19.0.0"}"#,
    ),
    (
      "/project/node_modules/react/jsx-dev-runtime.js",
      "exports.jsxDEV = function () {};\nexports.Fragment = 'fragment';\n",
    ),
  ]);

  let graph = parcel::build(
    &vec!["index.mdx".into()],
    memory_build_options(input_fs, "/project"),
  )
  .unwrap();
  assert_eq!(
    asset_path(&graph, "mdx-components.jsx"),
    Some(test_utils::path(
      "/project/node_modules/@parcel/parcel3/src/mdx-components.jsx"
    ))
  );
  assert_eq!(
    asset_path(&graph, "jsx-dev-runtime.js"),
    Some(test_utils::path(
      "/project/node_modules/react/jsx-dev-runtime.js"
    ))
  );
}

#[test]
fn libraries_bundle_parcel_runtime_modules() {
  let input_fs = memory_fs(&[
    (
      "/project/package.json",
      r#"{
        "name": "lib",
        "source": "index.js",
        "main": "dist/main.js",
        "module": "dist/module.mjs",
        "dependencies": {"react": "^19"}
      }"#,
    ),
    (
      "/project/index.js",
      "export {default as Doc} from './doc.mdx';\nexport * from './a.js';\n",
    ),
    ("/project/a.js", "export const a = 1;\n"),
    ("/project/doc.mdx", "```js\nlet x = 1;\n```\n"),
  ]);
  let output_fs = Arc::new(MemoryFileSystem::new());

  let graph = parcel::build(
    &vec![".".into()],
    BuildOptions {
      mode: parcel_core::BuildMode::Production,
      output_fs: output_fs.clone(),
      ..memory_build_options(input_fs, "/project")
    },
  )
  .unwrap();
  assert!(asset_path(&graph, "mdx-components.jsx").is_some());
  assert!(asset_path(&graph, "esmodule-helpers.js").is_some());
  for bundle in &graph.bundles {
    let code = output_fs.read_to_string(bundle.dist_path()).unwrap();
    assert!(
      !code.contains("@parcel/parcel3"),
      "{:?} imports Parcel's runtime modules:\n{code}",
      bundle.dist_path()
    );
  }
}

#[test]
fn react_refresh_runtime_import_is_the_projects() {
  // Parcel's React Refresh wrapper uses an embedded runtime, which a project's own import of
  // react-refresh does not get.
  let input_fs = memory_fs(&[
    ("/project/package.json", r#"{"name": "project"}"#),
    ("/project/index.js", "require('react-refresh/runtime');\n"),
    (
      "/project/node_modules/react-refresh/package.json",
      r#"{"name": "react-refresh", "version": "0.14.0"}"#,
    ),
    ("/project/node_modules/react-refresh/runtime.js", ""),
  ]);

  let graph = parcel::build(
    &vec!["index.js".into()],
    memory_build_options(input_fs, "/project"),
  )
  .unwrap();
  assert_eq!(
    asset_path(&graph, "runtime.js"),
    Some(test_utils::path(
      "/project/node_modules/react-refresh/runtime.js"
    ))
  );
}

#[test]
fn missing_swc_helpers_install_hint() {
  // Built in memory, since the repository's own node_modules would provide @swc/helpers.
  let input_fs = memory_fs(&[
    (
      "/project/package.json",
      r#"{"name": "project", "browserslist": "ie 11"}"#,
    ),
    ("/project/index.js", "class Foo {}\nnew Foo();\n"),
  ]);

  let options = memory_build_options(input_fs, "/project");
  let Err(diagnostics) = parcel::build(&vec!["index.js".into()], options) else {
    panic!("expected the build to fail");
  };
  assert_diagnostics(
    &diagnostics,
    &[
      Diagnostic {
        message: "Failed to resolve '@swc/helpers/".into(),
        origin: Some("@parcel/core".into()),
        ..Diagnostic::from_message(String::new())
      },
      Diagnostic {
        message: "Cannot find module '@swc/helpers'".into(),
        origin: Some("@parcel/resolver-default".into()),
        hints: vec!["Run `npm install @swc/helpers`".into()],
        ..Diagnostic::from_message(String::new())
      },
    ],
  );
}
