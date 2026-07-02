use parcel::make_parcel;
use parcel_core::{
  AssetType, BuildMode, BuildOptions, CodeFrame, CodeHighlight, Diagnostic, DiagnosticList,
  DiagnosticSeverity, Environment, FileSystem, Location, LogLevel, MemoryFileSystem, Parcel,
  PathId,
};
use parcel_js::hmr::get_hmr_update;
use parcel_plugin_js::{await_promise, create_runtime};
use rquickjs::{Function, Module, Object, Value};
use std::{
  collections::HashMap,
  path::Path,
  sync::{Arc, Mutex},
};

fn write_file(fs: &MemoryFileSystem, path: &str, contents: &str) {
  let path = Path::new(path);
  if let Some(parent) = path.parent() {
    fs.create_dir_all(PathId::new(parent)).unwrap();
  }
  fs.write(PathId::new(path), &contents.as_bytes().to_vec())
    .unwrap();
}

fn setup(files: &[(&str, &str)]) -> (Parcel, Arc<MemoryFileSystem>) {
  let input_fs = Arc::new(MemoryFileSystem::new());
  let output_fs = Arc::new(MemoryFileSystem::new());
  for (path, contents) in files {
    write_file(&input_fs, path, contents);
  }

  let options = BuildOptions {
    mode: BuildMode::Development,
    minify: None,
    env: HashMap::new(),
    log_level: LogLevel::Error,
    input_fs: input_fs.clone(),
    output_fs,
    config: None,
    cwd: PathId::new(Path::new("/project")),
  };

  let entries = vec!["/project/index.js".to_string()];
  let mut parcel = make_parcel(&entries, options).expect("Parcel::new failed");
  parcel.build().expect("initial build failed");
  (parcel, input_fs)
}

fn hmr_update_after_change(
  parcel: &mut Parcel,
  input_fs: &MemoryFileSystem,
  path: &str,
  contents: &str,
) -> (serde_json::Value, usize, usize) {
  write_file(input_fs, path, contents);
  let path_id = PathId::new(Path::new(path));
  let invalidate_result = parcel
    .invalidate(&[path_id], &[])
    .expect("invalidate failed");
  assert!(!invalidate_result.config_changed);
  assert!(!invalidate_result.affected.is_empty());

  let affected_count = invalidate_result.affected.len();
  let config = parcel.config.clone();
  let options = parcel.options.clone();
  let build_result = parcel
    .build_with_changes()
    .expect("incremental build failed");
  let changed_count = build_result.changed_assets.len();
  let graph = &build_result.bundle_graph;
  let changed_assets = build_result.changed_assets();
  let update = get_hmr_update(changed_assets, graph, &config, &options);

  (
    serde_json::to_value(update).unwrap(),
    affected_count,
    changed_count,
  )
}

struct HmrRuntimeTest {
  parcel: Parcel,
  input_fs: Arc<MemoryFileSystem>,
  js_env: parcel_plugin_js::JsEnv,
  outputs: Arc<Mutex<Vec<serde_json::Value>>>,
  reloaded: Arc<Mutex<bool>>,
}

impl HmrRuntimeTest {
  fn new(files: &[(&str, &str)]) -> Self {
    let (mut parcel, input_fs) = setup(files);
    let graph = parcel.build().expect("initial build failed");
    let initial_bundle_path = graph.bundles[0].dist_path().to_path_buf();
    drop(graph);

    let outputs = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let reloaded = Arc::new(Mutex::new(false));
    let mut env = HashMap::new();
    env.insert("NODE_ENV".into(), "test".into());
    let js_env = create_runtime(
      parcel.options.output_fs.clone(),
      &env,
      PathId::new(Path::new("/project")),
      Environment::Browser,
    )
    .unwrap();

    let initial_run_result = js_env.context.with(|ctx| -> rquickjs::Result<()> {
      let globals = ctx.globals();
      let console: Object = globals.get("console")?;
      console.set("clear", Function::new(ctx.clone(), || {})?)?;
      console.set("error", Function::new(ctx.clone(), || {})?)?;

      let output_values = outputs.clone();
      globals.set(
        "output",
        Function::new(ctx.clone(), move |args: rquickjs::function::Rest<Value>| {
          output_values.lock().unwrap().extend(
            args
              .0
              .into_iter()
              .map(|value| rquickjs_serde::from_value(value).unwrap()),
          );
        })?,
      )?;

      let location = Object::new(ctx.clone())?;
      location.set("protocol", "http:")?;
      location.set("hostname", "localhost")?;
      location.set("port", "1234")?;
      let did_reload = reloaded.clone();
      let outputs_to_clear = outputs.clone();
      location.set(
        "reload",
        Function::new(ctx.clone(), move || {
          *did_reload.lock().unwrap() = true;
          outputs_to_clear.lock().unwrap().clear();
        })?,
      )?;
      globals.set("location", location)?;

      ctx.eval::<(), _>(
        "globalThis.document = {
          createElement() { return {}; },
          getElementById() { return null; },
          body: {
            appendChild(element) {
              globalThis.__parcel_overlay_html__ = element.innerHTML;
            }
          }
        };",
      )?;

      globals.set("__parcel_hmr_test__", Object::new(ctx.clone())?)?;

      Module::import(&ctx, initial_bundle_path.to_string_lossy().into_owned())?
        .finish::<Value>()?;
      while ctx.execute_pending_job() {}
      Ok(())
    });
    if let Err(err) = initial_run_result {
      js_env.context.with(|ctx| {
        panic!(
          "runtime initial bundle failed: {:?}, exception: {:?}",
          err,
          ctx.catch()
        );
      });
    }

    HmrRuntimeTest {
      parcel,
      input_fs,
      js_env,
      outputs,
      reloaded,
    }
  }

  fn update(&mut self, updates: &[(&str, &str)]) {
    let changed_paths: Vec<PathId> = updates
      .iter()
      .map(|(path, contents)| {
        write_file(&self.input_fs, path, contents);
        PathId::new(Path::new(path))
      })
      .collect();

    let invalidate_result = self
      .parcel
      .invalidate(&changed_paths, &[])
      .expect("invalidate failed");
    assert!(!invalidate_result.config_changed);
    assert!(!invalidate_result.affected.is_empty());

    let config = self.parcel.config.clone();
    let options = self.parcel.options.clone();
    let build_result = self
      .parcel
      .build_with_changes()
      .expect("incremental build failed");
    let graph = &build_result.bundle_graph;
    let changed_assets = build_result.changed_assets();

    let update = get_hmr_update(changed_assets, graph, &config, &options);
    let update_result = self.js_env.context.with(|ctx| -> rquickjs::Result<()> {
      let update = serde_json::to_string(&update).unwrap();
      let res: Value = ctx.eval(format!(
        "globalThis.__parcel_hmr_test__.handleMessage({})",
        update
      ))?;
      await_promise(&ctx, res)?;
      while ctx.execute_pending_job() {}
      Ok(())
    });
    if let Err(err) = update_result {
      self.js_env.context.with(|ctx| {
        panic!(
          "runtime hmr update failed: {:?}, exception: {:?}",
          err,
          ctx.catch(),
        );
      });
    }
  }

  fn outputs(&self) -> Vec<serde_json::Value> {
    self.outputs.lock().unwrap().clone()
  }

  fn reloaded(&self) -> bool {
    *self.reloaded.lock().unwrap()
  }

  fn handle_message(&self, message: serde_json::Value) {
    let update_result = self.js_env.context.with(|ctx| -> rquickjs::Result<()> {
      let message = serde_json::to_string(&message).unwrap();
      let res: Value = ctx.eval(format!(
        "globalThis.__parcel_hmr_test__.handleMessage({})",
        message
      ))?;
      await_promise(&ctx, res)?;
      while ctx.execute_pending_job() {}
      Ok(())
    });
    if let Err(err) = update_result {
      self.js_env.context.with(|ctx| {
        panic!(
          "runtime hmr message failed: {:?}, exception: {:?}",
          err,
          ctx.catch(),
        );
      });
    }
  }

  fn overlay_html(&self) -> Option<String> {
    self
      .js_env
      .context
      .with(|ctx| ctx.eval("globalThis.__parcel_overlay_html__ || null"))
      .unwrap()
  }
}

#[test]
fn hmr_update_payload_contains_incrementally_changed_js_asset() {
  let (mut parcel, input_fs) = setup(&[
    (
      "/project/index.js",
      "import './foo.js';\nconsole.log('index');",
    ),
    ("/project/foo.js", "console.log('foo v1');"),
  ]);

  let (json, _affected_count, changed_count) = hmr_update_after_change(
    &mut parcel,
    &input_fs,
    "/project/foo.js",
    "console.log('foo v2');",
  );

  let assets = json["assets"].as_array().unwrap();
  assert_eq!(json["type"], "update");
  assert_eq!(assets.len(), changed_count);
  assert!(assets.iter().all(|asset| asset["type"] == "js"));
  assert!(assets.iter().all(|asset| {
    asset["output"]
      .as_str()
      .unwrap()
      .contains("parcelHotUpdate")
  }));
  assert!(
    assets
      .iter()
      .any(|asset| asset["output"].as_str().unwrap().contains("foo v2"))
  );
  assert!(
    assets
      .iter()
      .all(|asset| !asset["output"].as_str().unwrap().contains("foo v1"))
  );
}

#[test]
fn hmr_update_includes_new_dependency_added_by_changed_asset() {
  let (mut parcel, input_fs) = setup(&[
    (
      "/project/index.js",
      "import './foo.js';\nconsole.log('index');",
    ),
    ("/project/foo.js", "console.log('foo v1');"),
    ("/project/bar.js", "console.log('bar');"),
  ]);

  let (json, affected_count, changed_count) = hmr_update_after_change(
    &mut parcel,
    &input_fs,
    "/project/foo.js",
    "import './bar.js';\nconsole.log('foo v2');",
  );

  let assets = json["assets"].as_array().unwrap();
  assert_eq!(json["type"], "update");
  assert_eq!(assets.len(), changed_count);
  assert!(changed_count >= affected_count);
  assert!(
    assets
      .iter()
      .any(|asset| asset["output"].as_str().unwrap().contains("foo v2"))
  );
  assert!(
    assets
      .iter()
      .any(|asset| asset["output"].as_str().unwrap().contains("bar"))
  );
  assert!(
    assets
      .iter()
      .all(|asset| !asset["output"].as_str().unwrap().contains("foo v1"))
  );
}

#[test]
fn hmr_runtime_displays_build_errors() {
  let hmr = HmrRuntimeTest::new(&[(
    "/project/index.js",
    "output('initial'); if (module.hot) module.hot.accept();",
  )]);

  let diagnostics = DiagnosticList(vec![Diagnostic {
    message: "Unexpected <token>".into(),
    origin: Some("@parcel/test".into()),
    code_frames: vec![CodeFrame {
      code: Some("let value = foo < bar;\n".into()),
      url: None,
      language: Some(AssetType::Js),
      code_highlights: vec![CodeHighlight {
        message: Some("escape <this>".into()),
        start: Location {
          line: 1,
          column: 13,
        },
        end: Location {
          line: 1,
          column: 15,
        },
      }],
    }],
    hints: vec!["Use > instead".into()],
    severity: DiagnosticSeverity::Error,
    documentation_url: Some("https://example.com?a=<b>".into()),
  }]);

  hmr.handle_message(serde_json::json!({
    "type": "error",
    "diagnostics": diagnostics.render_for_browser(),
  }));

  let overlay = hmr.overlay_html().expect("overlay should be appended");
  assert!(overlay.contains("Unexpected &lt;token&gt;"));
  assert!(overlay.contains("foo"));
  assert!(overlay.contains("&lt;"));
  assert!(overlay.contains("bar"));
  assert!(overlay.contains("escape &lt;this&gt;"));
  assert!(overlay.contains("Use &gt; instead"));
  assert!(overlay.contains("https://example.com?a=&lt;b&gt;"));
  assert!(!hmr.reloaded());
}

#[test]
fn hmr_runtime_applies_hmr_update_with_new_dependency() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let foo = require('./foo.js');
output(['index', foo.value]);
if (module.hot) module.hot.accept();",
    ),
    (
      "/project/foo.js",
      "exports.value = 1;
output(['foo', exports.value]);
if (module.hot) module.hot.accept();",
    ),
    (
      "/project/bar.js",
      "exports.value = 2;
output(['bar', exports.value]);",
    ),
  ]);

  hmr.update(&[(
    "/project/foo.js",
    "let bar = require('./bar.js');
exports.value = bar.value;
output(['foo', exports.value]);
if (module.hot) module.hot.accept();",
  )]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!(["foo", 1]),
      serde_json::json!(["index", 1]),
      serde_json::json!(["bar", 2]),
      serde_json::json!(["foo", 2]),
    ]
  );
}

#[test]
fn hmr_runtime_supports_self_accepting_updates() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js'); output(['index', local.value]);",
    ),
    (
      "/project/local.js",
      "let other = require('./other.js');
exports.value = other.value;
output(['local', exports.value]);
if (module.hot) module.hot.accept();",
    ),
    (
      "/project/other.js",
      "exports.value = 1; output(['other', exports.value]);",
    ),
  ]);

  hmr.update(&[(
    "/project/other.js",
    "exports.value = 3; output(['other', exports.value]);",
  )]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!(["other", 1]),
      serde_json::json!(["local", 1]),
      serde_json::json!(["index", 1]),
      serde_json::json!(["other", 3]),
      serde_json::json!(["local", 3]),
    ]
  );
}

#[test]
fn hmr_runtime_bubbles_updates_to_accepting_parents() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js');
output(['index', local.value]);
if (module.hot) module.hot.accept();",
    ),
    (
      "/project/local.js",
      "let other = require('./other.js');
exports.value = other.value;
output(['local', exports.value]);",
    ),
    (
      "/project/other.js",
      "exports.value = 1; output(['other', exports.value]);",
    ),
  ]);

  hmr.update(&[(
    "/project/other.js",
    "exports.value = 3; output(['other', exports.value]);",
  )]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!(["other", 1]),
      serde_json::json!(["local", 1]),
      serde_json::json!(["index", 1]),
      serde_json::json!(["other", 3]),
      serde_json::json!(["local", 3]),
      serde_json::json!(["index", 3]),
    ]
  );
}

#[test]
fn hmr_runtime_calls_dispose_callbacks() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js');
output(['eval:index', local.value, module.hot.data || null]);
module.hot.accept();
module.hot.dispose(data => { output(['dispose:index', local.value]); data.value = local.value; });",
    ),
    (
      "/project/local.js",
      "let other = require('./other.js');
exports.value = other.value;
output(['eval:local', exports.value, module.hot.data || null]);
module.hot.dispose(data => { output(['dispose:local', exports.value]); data.value = exports.value; });",
    ),
    (
      "/project/other.js",
      "exports.value = 1;
output(['eval:other', exports.value, module.hot.data || null]);
module.hot.dispose(data => { output(['dispose:other', exports.value]); data.value = exports.value; });",
    ),
  ]);

  hmr.update(&[(
    "/project/other.js",
    "exports.value = 3;
output(['eval:other', exports.value, module.hot.data || null]);
module.hot.dispose(data => { output(['dispose:other', exports.value]); data.value = exports.value; });",
  )]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!(["eval:other", 1, null]),
      serde_json::json!(["eval:local", 1, null]),
      serde_json::json!(["eval:index", 1, null]),
      serde_json::json!(["dispose:other", 1]),
      serde_json::json!(["dispose:local", 1]),
      serde_json::json!(["dispose:index", 1]),
      serde_json::json!(["eval:other", 3, {"value": 1}]),
      serde_json::json!(["eval:local", 3, {"value": 1}]),
      serde_json::json!(["eval:index", 3, {"value": 1}]),
    ]
  );
}

#[test]
fn hmr_runtime_handles_circular_dependencies() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js');
function run() { output(local.a + local.b); }
if (module.hot) module.hot.accept();
run();
module.exports = 'value';",
    ),
    (
      "/project/local.js",
      "let other = require('./index.js');
exports.a = 1;
exports.b = 2;",
    ),
  ]);

  hmr.update(&[(
    "/project/local.js",
    "let other = require('./index.js');
exports.a = 5;
exports.b = 5;",
  )]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![serde_json::json!(3), serde_json::json!(10)]
  );
}

#[test]
fn hmr_runtime_updates_across_dynamic_import_bundle() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "globalThis.run = function() {
	  return import('./local.js').then(l => {
	    output(l.a + l.b);
	  });
	};
	if (module.hot) module.hot.accept();
	globalThis.run();",
    ),
    ("/project/local.js", "exports.a = 1; exports.b = 2;"),
  ]);

  hmr.update(&[("/project/local.js", "exports.a = 5; exports.b = 5;")]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![serde_json::json!(3), serde_json::json!(10)]
  );
}

#[test]
fn hmr_runtime_updates_module_containing_dynamic_import() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "function run() {
		  return import('./local.js').then(l => output(l.value));
		}
		if (module.hot) module.hot.accept();
		run();",
    ),
    ("/project/local.js", "exports.value = 1;"),
  ]);

  hmr.update(&[(
    "/project/index.js",
    "function run() {
		  return import('./local.js').then(l => output(l.value + 1));
		}
		if (module.hot) module.hot.accept();
		run();",
  )]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![serde_json::json!(1), serde_json::json!(2)]
  );
}

#[test]
fn hmr_runtime_reloads_when_update_is_not_accepted() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js'); output(local.a + local.b);",
    ),
    ("/project/local.js", "exports.a = 1; exports.b = 2;"),
  ]);

  hmr.update(&[("/project/local.js", "exports.a = 5; exports.b = 5;")]);

  assert!(hmr.reloaded());
  assert_eq!(hmr.outputs(), Vec::<serde_json::Value>::new());
}

#[test]
fn hmr_runtime_reloads_when_entry_is_updated_without_accepting() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js'); output(local.a + local.b);",
    ),
    ("/project/local.js", "exports.a = 1; exports.b = 2;"),
  ]);

  hmr.update(&[("/project/index.js", "output(5);")]);

  assert!(hmr.reloaded());
  assert_eq!(hmr.outputs(), Vec::<serde_json::Value>::new());
}

#[test]
fn hmr_runtime_updates_modules_with_multiple_parents() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let a = require('./a.js');
let b = require('./b.js');
output(a.a() + ' ' + b.b());
if (module.hot) module.hot.accept();",
    ),
    (
      "/project/a.js",
      "let utils = require('./utils.js'); exports.a = () => 'a: ' + utils.fn1();",
    ),
    (
      "/project/b.js",
      "let utils = require('./utils.js'); exports.b = () => 'b: ' + utils.fn2();",
    ),
    (
      "/project/utils.js",
      "exports.fn1 = require('./fn1.js').fn1;
exports.fn2 = require('./fn2.js').fn2;",
    ),
    ("/project/fn1.js", "exports.fn1 = () => 'fn1';"),
    ("/project/fn2.js", "exports.fn2 = () => 'fn2';"),
  ]);

  hmr.update(&[("/project/fn2.js", "exports.fn2 = () => 'UPDATED';")]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!("a: fn1 b: fn2"),
      serde_json::json!("a: fn1 b: UPDATED"),
    ]
  );
}

#[test]
fn hmr_runtime_reloads_if_only_one_parent_accepts() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let a = require('./a.js');
let b = require('./b.js');
output(a.a());
output(b.b());",
    ),
    (
      "/project/a.js",
      "let fn2 = require('./fn2.js');
exports.a = () => 'a: ' + fn2.fn2();
if (module.hot) module.hot.accept();",
    ),
    (
      "/project/b.js",
      "let fn2 = require('./fn2.js'); exports.b = () => 'b: ' + fn2.fn2();",
    ),
    ("/project/fn2.js", "exports.fn2 = () => 'fn2';"),
  ]);

  hmr.update(&[("/project/fn2.js", "exports.fn2 = () => 'UPDATED';")]);

  assert!(hmr.reloaded());
  assert_eq!(hmr.outputs(), Vec::<serde_json::Value>::new());
}

#[test]
fn hmr_runtime_accept_callback_can_bubble_to_additional_parents() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "require('./middle.js');
output('root');
module.hot.accept(() => { output('accept root'); });",
    ),
    ("/project/middle.js", "require('./child.js');"),
    (
      "/project/child.js",
      "let updated = require('./updated.js');
output('child ' + updated.a);
module.hot.accept(getParents => {
  output('accept child');
  return getParents();
});",
    ),
    ("/project/updated.js", "exports.a = 2;"),
  ]);

  hmr.update(&[("/project/updated.js", "exports.a = 3;")]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!("child 2"),
      serde_json::json!("root"),
      serde_json::json!("child 3"),
      serde_json::json!("accept child"),
      serde_json::json!("root"),
      serde_json::json!("accept root"),
    ]
  );
}

#[test]
fn hmr_runtime_reloads_when_additional_parent_bubbling_is_not_accepted() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "require('./middle.js');
output('root');",
    ),
    ("/project/middle.js", "require('./child.js');"),
    (
      "/project/child.js",
      "let updated = require('./updated.js');
output('child ' + updated.a);
module.hot.accept(getParents => {
  output('accept child');
  return getParents();
});",
    ),
    ("/project/updated.js", "exports.a = 2;"),
  ]);

  hmr.update(&[("/project/updated.js", "exports.a = 3;")]);

  assert!(hmr.reloaded());
  assert_eq!(hmr.outputs(), Vec::<serde_json::Value>::new());
}
