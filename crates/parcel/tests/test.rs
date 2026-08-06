use std::{
  cell::RefCell,
  collections::HashMap,
  path::{Path, PathBuf},
  sync::Arc,
};

use parcel_core::{
  AssetIndex, AssetType, BuildOptions, BundleBehavior, BundleFlags, BundleGraph, CodeFrame,
  CodeHighlight, DependencyResolution, Diagnostic, DiagnosticList, DiagnosticSeverity, Environment,
  EnvironmentFlags, FileSystem, MemoryFileSystem, OsFileSystem, OutputFormat, OverlayFileSystem,
  PathId, SymbolResolution,
};
use parcel_plugin_js::{create_runtime, require_module};
use pretty_assertions::assert_eq;
use rquickjs::Function;

fn run(
  paths: Vec<(PathBuf, OutputFormat)>,
  fs: Arc<dyn FileSystem>,
  cwd: &Path,
  environment: Environment,
  entry: String,
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
    for (path, output_format) in paths {
      if output_format == OutputFormat::Esmodule || output_format == OutputFormat::Global {
        imported = Some(
          rquickjs::Module::import(&ctx, path.to_str().unwrap().to_owned())
            .and_then(|p| p.finish::<rquickjs::Value>())?,
        );
      } else {
        imported = Some(require_module(ctx, path.to_str().unwrap())?);
      }
    }

    let output: rquickjs::Result<rquickjs::Value> = if is_library {
      Ok(imported.unwrap())
    } else {
      let parcel_require: Option<Function> = ctx.globals().get("parcelRequire").ok();
      if let Some(parcel_require) = parcel_require {
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
    source_map: Some(Default::default()),
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: output_fs.clone(),
    log_level: parcel_core::LogLevel::Verbose,
    config: options.config,
    cwd: PathId::new(cwd),
    dist_dir: None,
    public_url: Default::default(),
    hmr: None,
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

  let mut scripts = Vec::new();
  let mut main = None;

  if !test.bundles.is_empty() {
    assert_eq!(
      test.bundles.len(),
      bundle_graph.bundles.len(),
      "Expected number of bundles did not match"
    );
    for bundle in &bundle_graph.bundles {
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
          if test.skip_node_modules && !path.to_path_buf().starts_with(fixture_dir) {
            return None;
          }
          Some(path.file_name().to_string())
        })
        .collect();
      names.sort_unstable();
      let found = test.bundles.iter().find(|b| {
        b.assets == names
          && (b.ty.is_none() || b.ty.as_ref().unwrap() == &bundle.ty)
          && (b.environment.is_none()
            || b.environment.as_ref().unwrap() == &bundle.target.environment)
          && (b.name.is_none()
            || Path::new(b.name.as_ref().unwrap())
              == bundle.dist_path().relative(&bundle.target.dist_dir))
      });
      assert!(
        found.is_some(),
        "Could not find bundle with expected assets. Actual assets: {:?}, name: {:?}",
        names,
        bundle.dist_path
      );
      let found = found.unwrap();
      if !found.contains.is_empty() {
        let contents = output_fs.read_to_string(bundle.dist_path()).unwrap();
        for substring in &found.contains {
          assert!(
            contents.contains(substring),
            "Bundle {:?} did not contain expected substring {:?}\n\nBundle contents: {}",
            bundle.dist_path.as_ref().unwrap(),
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
            bundle.dist_path.as_ref().unwrap(),
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
              vec![(path.to_path_buf(), bundle.target.output_format)],
              output_fs.clone(),
              &cwd,
              Environment::Node,
              bundle_graph
                .asset_graph
                .asset(bundle.main_entry_asset.unwrap())
                .id(&bundle_graph.project_root),
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
            scripts.push((path.to_path_buf(), bundle.target.output_format));
            env = bundle.target.environment;
          }
        }
        AssetType::Html => {
          let deps = parcel_html::transform_html(parcel_html::TransformOptions {
            code: output_fs.read(path).unwrap(),
            url: bundle.dist_url(),
            xml: false,
            target: Default::default(),
            hmr: false,
          });

          for dep in deps.dependencies {
            match dep.resolution {
              DependencyResolution::Deferred(_) => {}
              _ => {
                let resolved = path.parent().unwrap().join(Path::new(&dep.specifier));

                if resolved
                  .extension()
                  .map_or(false, |e| e == "mjs" || e == "js")
                {
                  let b = bundle_graph
                    .bundles
                    .iter()
                    .find(|b| b.dist_path() == resolved)
                    .unwrap();
                  if let Some(m) = b.main_entry_asset {
                    main = Some(
                      bundle_graph
                        .asset_graph
                        .asset(m)
                        .id(&bundle_graph.project_root),
                    );
                  }

                  scripts.push((resolved.to_path_buf(), b.target.output_format));
                }
              }
            }
          }
        }
        _ => {}
      }
    }

    if !scripts.is_empty()
      && let Some(main) = main
    {
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
        .expect("could not find bundle");

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
  /// `skipNodeModules` option.
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
  #[serde(alias = "context")]
  environment: Option<Environment>,
  #[serde(default)]
  assets: Vec<String>,
  #[serde(rename = "type")]
  ty: Option<AssetType>,
  #[serde(default)]
  contains: Vec<String>,
  #[serde(default)]
  not_contains: Vec<String>,
}

#[derive(serde::Deserialize, Default)]
struct TestOptions {
  #[serde(default)]
  mode: parcel_core::BuildMode,
  minify: Option<bool>,
  #[serde(default)]
  env: HashMap<String, String>,
  cwd: Option<String>,
  config: Option<String>,
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
