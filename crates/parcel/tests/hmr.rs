use parcel::make_parcel;
use parcel_core::{
  AssetType, BuildMode, BuildOptions, CodeFrame, CodeHighlight, Diagnostic, DiagnosticList,
  DiagnosticSeverity, Environment, FileSystem, HmrOptions, Location, LogLevel, MemoryFileSystem,
  Parcel, PathId,
};
use parcel_js::hmr::{HmrUpdate, get_hmr_update};
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
  setup_entries(files, &["/project/index.js"])
}

fn setup_entries(files: &[(&str, &str)], entries: &[&str]) -> (Parcel, Arc<MemoryFileSystem>) {
  let input_fs = Arc::new(MemoryFileSystem::new());
  let output_fs = Arc::new(MemoryFileSystem::new());
  for (path, contents) in files {
    write_file(&input_fs, path, contents);
  }

  let options = BuildOptions {
    mode: BuildMode::Development,
    optimize: None,
    content_hash: None,
    source_map: Some(Default::default()),
    env: HashMap::new(),
    log_level: LogLevel::Error,
    input_fs: input_fs.clone(),
    output_fs,
    config: None,
    cwd: PathId::new(Path::new("/project")),
    dist_dir: None,
    public_url: Default::default(),
    hmr: Some(HmrOptions {
      host: "0.0.0.0".into(),
      port: 1234,
    }),
    reporters: Vec::new(),
  };

  let entries = entries.iter().map(|entry| entry.to_string()).collect();
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
    .invalidate(&[path_id], &[], &[])
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

#[test]
fn hmr_reload_serializes_for_the_runtime() {
  let update: HmrUpdate<'static> = HmrUpdate::Reload;
  let message = serde_json::to_value(update).unwrap();
  assert_eq!(message, serde_json::json!({"type": "reload"}));

  let hmr = HmrRuntimeTest::new(&[(
    "/project/index.js",
    "output('initial'); if (module.hot) module.hot.accept();",
  )]);
  assert!(!hmr.reloaded());
  hmr.handle_message(message);
  assert!(hmr.reloaded());
}

#[test]
fn hmr_reloads_when_config_changes() {
  let (mut parcel, input_fs) = setup(&[
    (
      "/project/.parcelrc",
      r#"{"extends": "@parcel/config-default"}"#,
    ),
    (
      "/project/index.js",
      "output('initial'); if (module.hot) module.hot.accept();",
    ),
  ]);

  // The asset graph is rebuilt from scratch, so even a self-accepting module can't be updated.
  write_file(
    &input_fs,
    "/project/.parcelrc",
    r#"{"extends": "@parcel/config-default", "transformers": {}}"#,
  );
  let invalidate_result = parcel
    .invalidate(&[PathId::new(Path::new("/project/.parcelrc"))], &[], &[])
    .expect("invalidate failed");
  assert!(invalidate_result.config_changed);

  let config = parcel.config.clone();
  let options = parcel.options.clone();
  let build_result = parcel.build_with_changes().expect("rebuild failed");
  let update = parcel::hmr_updates(true, &build_result, &config, &options, None).browser;
  assert_eq!(
    serde_json::to_value(update).unwrap(),
    serde_json::json!({"type": "reload"})
  );
}

/// Rebuilds after changing `path`, and returns the updates for the process running the Node entry
/// and for browsers.
fn split_hmr_updates_after_change(
  parcel: &mut Parcel,
  input_fs: &MemoryFileSystem,
  path: &str,
  contents: &str,
) -> (serde_json::Value, serde_json::Value) {
  write_file(input_fs, path, contents);
  parcel
    .invalidate(&[PathId::new(Path::new(path))], &[], &[])
    .expect("invalidate failed");
  let config = parcel.config.clone();
  let options = parcel.options.clone();
  let result = parcel
    .build_with_changes()
    .expect("incremental build failed");
  let entry = result
    .bundle_graph
    .bundles
    .iter()
    .position(|bundle| bundle.target.environment == Environment::Node);
  assert!(entry.is_some());
  let updates = parcel::hmr_updates(false, &result, &config, &options, entry);
  (
    serde_json::to_value(updates.server).unwrap(),
    serde_json::to_value(updates.browser).unwrap(),
  )
}

fn server_and_browser_project() -> (Parcel, Arc<MemoryFileSystem>) {
  setup_entries(
    &[
      ("/project/package.json", r#"{"engines": {"node": ">=22"}}"#),
      (
        "/project/server.js",
        "output(require('./message.js').message);",
      ),
      ("/project/message.js", "exports.message = 'server';"),
      (
        "/project/index.html",
        r#"<script type="module" src="client.js"></script>"#,
      ),
      ("/project/client.js", "output('client');"),
    ],
    &["/project/server.js", "/project/index.html"],
  )
}

fn update_asset_outputs(update: &serde_json::Value) -> Vec<String> {
  update["assets"]
    .as_array()
    .unwrap()
    .iter()
    .map(|asset| asset["output"].as_str().unwrap().to_string())
    .collect()
}

#[test]
fn hmr_updates_send_browser_changes_only_to_browsers() {
  let (mut parcel, input_fs) = server_and_browser_project();
  let (server, browser) = split_hmr_updates_after_change(
    &mut parcel,
    &input_fs,
    "/project/client.js",
    "output('v2');",
  );

  assert_eq!(server, serde_json::Value::Null);
  assert_eq!(browser["type"], "update");
  assert_eq!(browser.get("serverChanged"), None);
  let outputs = update_asset_outputs(&browser);
  assert_eq!(outputs.len(), 1);
  assert!(outputs[0].contains("output('v2')"));
}

#[test]
fn hmr_updates_tell_browsers_when_server_code_changes() {
  let (mut parcel, input_fs) = server_and_browser_project();
  let (server, browser) = split_hmr_updates_after_change(
    &mut parcel,
    &input_fs,
    "/project/message.js",
    "exports.message = 'v2';",
  );

  assert_eq!(server["type"], "update");
  let outputs = update_asset_outputs(&server);
  assert_eq!(outputs.len(), 1);
  assert!(outputs[0].contains("'v2'"));
  assert_eq!(
    browser,
    serde_json::json!({"type": "update", "assets": [], "serverChanged": true})
  );
}

#[test]
fn css_bundle_name_is_stable_when_its_assets_change() {
  let (mut parcel, input_fs) = setup(&[
    (
      "/project/index.js",
      "import './styles.css'; if (module.hot) module.hot.accept();",
    ),
    ("/project/styles.css", ".styles { color: red; }"),
    ("/project/theme.css", ".theme { color: blue; }"),
  ]);

  let (old_name, old_asset_count) = {
    let bundle_graph = parcel.build().expect("initial build failed");
    let bundle = bundle_graph
      .bundles
      .iter()
      .find(|bundle| bundle.ty == AssetType::Css)
      .expect("expected a CSS bundle");
    (bundle.name(), bundle.assets.len())
  };

  write_file(
    &input_fs,
    "/project/styles.css",
    "@import './theme.css'; .styles { color: red; }",
  );
  parcel
    .invalidate(&[PathId::new(Path::new("/project/styles.css"))], &[], &[])
    .expect("invalidate failed");
  let result = parcel
    .build_with_changes()
    .expect("incremental build failed");
  let bundle = result
    .bundle_graph
    .bundles
    .iter()
    .find(|bundle| bundle.ty == AssetType::Css)
    .expect("expected a CSS bundle");

  assert!(
    bundle.assets.len() > old_asset_count,
    "the CSS bundle should contain the newly imported asset"
  );
  assert_eq!(bundle.name(), old_name);
  assert!(
    !result.output_paths_changed,
    "stable bundle names should avoid the correctness reload fallback"
  );
}

#[test]
fn macro_emitted_css_is_repackaged_when_content_returns_to_a_previous_value() {
  let (mut parcel, input_fs) = setup(&[
    (
      "/project/index.js",
      r#"import { css } from "./macro.mjs" with { type: "macro" };
output(css("background: red"));"#,
    ),
    (
      "/project/macro.mjs",
      r#"export function css(code) {
  let className = code.includes("red") ? "red_hash" : "green_hash";
  this.addAsset({
    type: "css",
    content: `.${className} { ${code} }`
  });
  return className;
}"#,
    ),
  ]);
  let output_fs = parcel.options.output_fs.clone();

  let assert_outputs = |graph: &parcel_core::BundleGraph<'_>, color, class_name| {
    let js = graph
      .bundles
      .iter()
      .find(|bundle| bundle.ty == AssetType::Js)
      .expect("expected a JS bundle");
    let css = graph
      .bundles
      .iter()
      .find(|bundle| bundle.ty == AssetType::Css)
      .expect("expected a CSS bundle");
    let js = output_fs.read_to_string(js.dist_path()).unwrap();
    let css = output_fs.read_to_string(css.dist_path()).unwrap();

    assert!(
      js.contains(class_name),
      "JS bundle did not contain {class_name}: {js}"
    );
    assert!(
      css.contains(color),
      "CSS bundle did not contain {color}: {css}"
    );
    assert!(
      css.contains(class_name),
      "CSS bundle did not contain {class_name}: {css}"
    );
  };

  {
    let graph = parcel.build().expect("initial build failed");
    assert_outputs(&graph, "background: red", "red_hash");
  }

  write_file(
    &input_fs,
    "/project/index.js",
    r#"import { css } from "./macro.mjs" with { type: "macro" };
output(css("background: green"));"#,
  );
  parcel
    .invalidate(&[PathId::new(Path::new("/project/index.js"))], &[], &[])
    .expect("invalidate failed");
  {
    let result = parcel
      .build_with_changes()
      .expect("first incremental build failed");
    assert_outputs(&result.bundle_graph, "background: green", "green_hash");
  }

  write_file(
    &input_fs,
    "/project/index.js",
    r#"import { css } from "./macro.mjs" with { type: "macro" };
output(css("background: red"));"#,
  );
  parcel
    .invalidate(&[PathId::new(Path::new("/project/index.js"))], &[], &[])
    .expect("invalidate failed");
  let result = parcel
    .build_with_changes()
    .expect("second incremental build failed");
  assert_outputs(&result.bundle_graph, "background: red", "red_hash");
}

#[test]
fn hmr_update_reloads_for_esm_sync_bundle_imports() {
  let (mut parcel, input_fs) = setup(&[
    (
      "/project/.parcelrc",
      r#"{
        "extends": "@parcel/config-default",
        "transformers": {
          "raw-json:*.json": ["@parcel/transformer-raw"]
        }
      }"#,
    ),
    (
      "/project/package.json",
      r#"{
        "targets": {
          "default": {
            "context": "node",
            "outputFormat": "esmodule"
          }
        }
      }"#,
    ),
    (
      "/project/index.js",
      "const data = require('raw-json:./data.json'); output(data.value);",
    ),
    ("/project/data.json", r#"{"value":42}"#),
  ]);

  let (update, _, _) = hmr_update_after_change(
    &mut parcel,
    &input_fs,
    "/project/index.js",
    "const data = require('raw-json:./data.json'); output(data.value + 1);",
  );
  let assets = update["assets"].as_array().unwrap();
  let sync_bundle = assets
    .iter()
    .find(|asset| asset["id"].as_str().is_some_and(|id| id.starts_with('b')))
    .expect("expected a sync bundle HMR asset");
  assert_eq!(sync_bundle["type"], "json");
  assert_eq!(sync_bundle["output"], "");
}

#[test]
fn hmr_runtime_exposes_the_dev_server_origin() {
  // React's RSC client requests source maps of server code from `parcelRequire.meta.devServer`.
  let hmr = HmrRuntimeTest::new(&[(
    "/project/index.js",
    "output(import.meta.devServer, parcelRequire.meta.devServer);",
  )]);
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!("http://localhost:1234"),
      serde_json::json!("http://localhost:1234")
    ]
  );
}

#[test]
fn hmr_update_defines_node_globals_through_the_bundle() {
  let (mut parcel, input_fs) = setup(&[
    (
      "/project/package.json",
      r#"{"targets": {"default": {"context": "node"}}}"#,
    ),
    ("/project/index.js", "output(__dirname, __filename);"),
  ]);

  // The bundle's path helpers aren't in scope of an evaluated update, so it reaches them through
  // `module.bundle`, with paths relative to the dist root.
  let (update, _, _) = hmr_update_after_change(
    &mut parcel,
    &input_fs,
    "/project/index.js",
    "output('updated', __dirname, __filename);",
  );
  let outputs = update_asset_outputs(&update);
  assert_eq!(outputs.len(), 1);
  let resolve = "module.bundle.nodePath.resolve(module.bundle.bundleDir, module.bundle.distDir, ";
  assert!(
    outputs[0].contains(&format!(r#"var __filename = {resolve}"../index.js")"#)),
    "{}",
    outputs[0]
  );
  assert!(
    outputs[0].contains(&format!(r#"var __dirname = {resolve}"../")"#)),
    "{}",
    outputs[0]
  );
}

#[test]
fn hmr_runtime_updates_modules_using_import_meta_in_esm_bundles() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/package.json",
      r#"{"targets": {"default": {"outputFormat": "esmodule"}}}"#,
    ),
    (
      "/project/index.js",
      "output(new URL('./data.txt', import.meta.url).href);
if (module.hot) module.hot.accept();",
    ),
    ("/project/data.txt", "data"),
  ]);
  let initial = hmr.outputs();
  assert_eq!(initial.len(), 1);

  // The bundle leaves `import.meta.url` in the module, which isn't valid in an evaluated update.
  hmr.update(&[(
    "/project/index.js",
    "output(new URL('./data.txt', import.meta.url).href, 'updated');
if (module.hot) module.hot.accept();",
  )]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![
      initial[0].clone(),
      initial[0].clone(),
      serde_json::json!("updated")
    ]
  );
}

const ESM_SYNC_BUNDLE_FILES: &[(&str, &str)] = &[
  (
    "/project/.parcelrc",
    r#"{
      "extends": "@parcel/config-default",
      "transformers": {
        "raw-json:*.json": ["@parcel/transformer-raw"]
      }
    }"#,
  ),
  (
    "/project/package.json",
    r#"{"targets": {"default": {"outputFormat": "esmodule"}}}"#,
  ),
  (
    "/project/index.js",
    "const data = require('raw-json:./data.json');
output(data.value);
if (module.hot) module.hot.accept();",
  ),
  ("/project/data.json", r#"{"value":42}"#),
  ("/project/other.json", r#"{"value":1}"#),
];

#[test]
fn hmr_runtime_updates_modules_importing_esm_sync_bundles() {
  let mut hmr = HmrRuntimeTest::new(ESM_SYNC_BUNDLE_FILES);
  assert_eq!(hmr.outputs(), vec![serde_json::json!(42)]);

  // The update lists the JSON bundle the module imports, but the page already imports it.
  hmr.update(&[(
    "/project/index.js",
    "const data = require('raw-json:./data.json');
output(data.value + 1);
if (module.hot) module.hot.accept();",
  )]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![serde_json::json!(42), serde_json::json!(43)]
  );
}

#[test]
fn hmr_runtime_reloads_when_update_imports_a_new_esm_sync_bundle() {
  let mut hmr = HmrRuntimeTest::new(ESM_SYNC_BUNDLE_FILES);

  hmr.update(&[(
    "/project/index.js",
    "const data = require('raw-json:./data.json');
const other = require('raw-json:./other.json');
output(data.value + other.value);
if (module.hot) module.hot.accept();",
  )]);

  assert!(hmr.reloaded());
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
      .invalidate(&changed_paths, &[], &[])
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

  fn eval(&self, code: &str) {
    self
      .js_env
      .context
      .with(|ctx| ctx.eval::<(), _>(code))
      .unwrap();
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
fn hmr_update_reloads_when_async_module_changes() {
  let (mut parcel, input_fs) = setup(&[
    (
      "/project/index.js",
      "import './async.js';\nconsole.log('index');",
    ),
    ("/project/async.js", "await 0;\nconsole.log('async v1');"),
  ]);

  let (json, _, _) = hmr_update_after_change(
    &mut parcel,
    &input_fs,
    "/project/async.js",
    "await 0;\nconsole.log('async v2');",
  );

  assert_eq!(json, serde_json::json!({"type": "reload"}));
}

#[test]
fn hmr_runtime_reloads_when_update_bubbles_to_async_module() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js');
await 0;
output(['index', local.value]);
if (module.hot) module.hot.accept();",
    ),
    ("/project/local.js", "exports.value = 1;"),
  ]);

  hmr.update(&[("/project/local.js", "exports.value = 2;")]);

  assert!(hmr.reloaded());
  assert_eq!(hmr.outputs(), Vec::<serde_json::Value>::new());
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

/// Stubs the `window` events the runtime dispatches, recording them in `__events__`.
const WINDOW_EVENTS: &str = "
  globalThis.__events__ = [];
  globalThis.CustomEvent = class {
    constructor(type) { this.type = type; this.defaultPrevented = false; }
    preventDefault() { this.defaultPrevented = true; }
  };
  globalThis.window = {
    dispatchEvent(event) {
      __events__.push(event.type);
      if (event.type === 'parcelhmrreload' && globalThis.__prevent_reload__) {
        event.preventDefault();
      }
      return !event.defaultPrevented;
    },
  };
";

#[test]
fn hmr_runtime_reloads_when_server_code_changes() {
  let hmr = HmrRuntimeTest::new(&[(
    "/project/index.js",
    "output('initial'); if (module.hot) module.hot.accept();",
  )]);
  hmr.eval(WINDOW_EVENTS);
  hmr.handle_message(serde_json::json!({"type": "update", "assets": [], "serverChanged": true}));
  assert!(hmr.reloaded());
}

#[test]
fn hmr_runtime_lets_the_page_refresh_itself_when_server_code_changes() {
  let hmr = HmrRuntimeTest::new(&[(
    "/project/index.js",
    "output('initial'); if (module.hot) module.hot.accept();",
  )]);
  hmr.eval(WINDOW_EVENTS);
  hmr.eval("globalThis.__prevent_reload__ = true;");
  hmr.handle_message(serde_json::json!({"type": "update", "assets": [], "serverChanged": true}));
  assert!(!hmr.reloaded());
  let events: Vec<String> = hmr
    .js_env
    .context
    .with(|ctx| {
      let events: Value = ctx.eval("globalThis.__events__")?;
      Ok::<_, rquickjs::Error>(rquickjs_serde::from_value(events).unwrap())
    })
    .unwrap();
  assert_eq!(events, ["parcelhmrreload", "parcelhmraccept"]);
}

#[test]
fn hmr_runtime_reruns_modules_into_their_exports_object() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js');
globalThis.read = () => output([local.value, local.removed]);",
    ),
    (
      "/project/local.js",
      "exports.value = 1; exports.removed = true; if (module.hot) module.hot.accept();",
    ),
  ]);

  hmr.update(&[(
    "/project/local.js",
    "exports.value = 2; if (module.hot) module.hot.accept();",
  )]);
  hmr.eval("globalThis.read()");

  assert!(!hmr.reloaded());
  // `index.js` didn't re-run, but reads the new exports through the object it kept.
  assert_eq!(hmr.outputs(), vec![serde_json::json!([2, null])]);
}

#[test]
fn hmr_runtime_keeps_previous_exports_when_a_module_replaces_them() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js');
globalThis.read = () => output(local.value);",
    ),
    (
      "/project/local.js",
      "exports.value = 1; if (module.hot) module.hot.accept();",
    ),
  ]);

  hmr.update(&[(
    "/project/local.js",
    "module.exports = {value: 2}; if (module.hot) module.hot.accept();",
  )]);
  hmr.eval("globalThis.read()");

  assert!(!hmr.reloaded());
  assert_eq!(hmr.outputs(), vec![serde_json::json!(1)]);
}

#[test]
fn hmr_runtime_uses_a_new_exports_object_when_the_previous_one_cannot_be_cleared() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "let local = require('./local.js');
globalThis.read = () => output(local.value);",
    ),
    (
      "/project/local.js",
      "Object.defineProperty(exports, 'value', {value: 1, enumerable: true});
if (module.hot) module.hot.accept();",
    ),
  ]);

  hmr.update(&[(
    "/project/local.js",
    "Object.defineProperty(exports, 'value', {value: 2, enumerable: true});
output(['local', exports.value]);
if (module.hot) module.hot.accept();",
  )]);
  hmr.eval("globalThis.read()");

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![serde_json::json!(["local", 2]), serde_json::json!(1)]
  );
}

#[test]
fn hmr_runtime_refreshes_react_components_with_the_embedded_runtime() {
  // The project has neither react-refresh nor @parcel/parcel3 installed.
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/package.json",
      r#"{"name": "project", "dependencies": {"react": "*"}}"#,
    ),
    (
      "/project/node_modules/react/package.json",
      r#"{"name": "react", "version": "19.0.0"}"#,
    ),
    (
      "/project/node_modules/react/index.js",
      "exports.createElement = function (type) { return type; };",
    ),
    // React Refresh only runs in a browser window.
    ("/project/window.js", "globalThis.window = globalThis;"),
    (
      "/project/index.js",
      "import './window.js';
import {App} from './App.js';
output(['index', typeof globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__]);",
    ),
    (
      "/project/App.js",
      "import React from 'react';
output('App 1');
export function App() { return React.createElement('div'); }",
    ),
  ]);

  hmr.update(&[(
    "/project/App.js",
    "import React from 'react';
output('App 2');
export function App() { return React.createElement('span'); }",
  )]);

  // The runtime installed its devtools hook, and App.js is a refresh boundary, so it re-runs alone.
  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!("App 1"),
      serde_json::json!(["index", "object"]),
      serde_json::json!("App 2"),
    ]
  );
}

#[test]
fn hmr_runtime_supports_accepting_dependency_updates() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "import {value} from './local.js';
output('index');
globalThis.read = () => output(['read', value]);
if (module.hot) module.hot.accept('./local.js', ids => output(['accepted', ids.length]));",
    ),
    (
      "/project/local.js",
      "export const value = 1; output('local');",
    ),
  ]);

  hmr.update(&[(
    "/project/local.js",
    "export const value = 2; output('local');",
  )]);
  hmr.eval("globalThis.read()");

  assert!(!hmr.reloaded());
  // `local.js` re-runs, but `index.js` doesn't. It reads the new value through its import.
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!("local"),
      serde_json::json!("index"),
      serde_json::json!("local"),
      serde_json::json!(["accepted", 1]),
      serde_json::json!(["read", 2]),
    ]
  );
}

#[test]
fn hmr_runtime_bubbles_updates_to_parents_accepting_dependencies() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "import {value} from './middle.js';
globalThis.read = () => output(['read', value]);
if (module.hot) module.hot.accept(['./middle.js'], () => output('accepted'));",
    ),
    (
      "/project/middle.js",
      "import {value as leaf} from './leaf.js'; export const value = leaf; output('middle');",
    ),
    ("/project/leaf.js", "export const value = 1;"),
  ]);

  hmr.update(&[("/project/leaf.js", "export const value = 2;")]);
  hmr.eval("globalThis.read()");

  assert!(!hmr.reloaded());
  // `middle.js` copied the value from `leaf.js` when it ran, so it re-runs too.
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!("middle"),
      serde_json::json!("middle"),
      serde_json::json!("accepted"),
      serde_json::json!(["read", 2]),
    ]
  );
}

#[test]
fn hmr_runtime_reloads_if_only_one_importer_accepts_a_dependency() {
  let mut hmr = HmrRuntimeTest::new(&[
    ("/project/index.js", "import './a.js'; import './b.js';"),
    (
      "/project/a.js",
      "import './shared.js'; if (module.hot) module.hot.accept('./shared.js', () => output('accepted'));",
    ),
    ("/project/b.js", "import './shared.js';"),
    ("/project/shared.js", "export const value = 1;"),
  ]);

  hmr.update(&[("/project/shared.js", "export const value = 2;")]);

  assert!(hmr.reloaded());
}

#[test]
fn hmr_runtime_calls_dependency_accept_callbacks_once() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "import './a.js'; import './b.js';
if (module.hot) module.hot.accept(['./a.js', './b.js'], ids => output(ids.length));",
    ),
    ("/project/a.js", "export const value = 1;"),
    ("/project/b.js", "export const value = 1;"),
  ]);

  hmr.update(&[
    ("/project/a.js", "export const value = 2;"),
    ("/project/b.js", "export const value = 2;"),
  ]);

  assert!(!hmr.reloaded());
  assert_eq!(hmr.outputs(), vec![serde_json::json!(2)]);
}

#[test]
fn hmr_runtime_does_not_reuse_exports_a_module_replaced() {
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "globalThis.shared = {value: 1};
let local = require('./local.js');
globalThis.read = () => output([local.value, globalThis.shared.value]);",
    ),
    (
      "/project/local.js",
      "module.exports = globalThis.shared; if (module.hot) module.hot.accept();",
    ),
  ]);

  hmr.update(&[(
    "/project/local.js",
    "module.exports = globalThis.shared; output('local'); if (module.hot) module.hot.accept();",
  )]);
  hmr.eval("globalThis.read()");

  assert!(!hmr.reloaded());
  // The object `local.js` exported belongs to other code, so it must not be cleared.
  assert_eq!(
    hmr.outputs(),
    vec![serde_json::json!("local"), serde_json::json!([1, 1])]
  );
}

#[test]
fn editing_a_file_does_not_invalidate_inline_assets_emitted_from_it() {
  let (mut parcel, input_fs) = setup_entries(
    &[(
      "/project/index.html",
      "<p>v1</p><script type=\"module\">console.log('a');</script>",
    )],
    &["/project/index.html"],
  );
  write_file(
    &input_fs,
    "/project/index.html",
    "<p>v2</p><script type=\"module\">console.log('a');</script>",
  );
  let result = parcel
    .invalidate(&[PathId::new(Path::new("/project/index.html"))], &[], &[])
    .expect("invalidate failed");

  // Only the HTML file. Its re-transform provides the inline script's content.
  assert_eq!(result.affected.len(), 1);
}

#[test]
fn hmr_runtime_updates_importers_when_a_reexport_target_changes() {
  // The importer's dependency map points at the module that declares the re-exported binding,
  // so changing the re-export must update the importer too.
  let mut hmr = HmrRuntimeTest::new(&[
    (
      "/project/index.js",
      "import {value} from './lib.js';
output(['index', value]);
if (module.hot) module.hot.accept();",
    ),
    ("/project/lib.js", "export {value} from './a.js';"),
    ("/project/a.js", "export const value = 'from-a';"),
    ("/project/b.js", "export const value = 'from-b';"),
  ]);

  hmr.update(&[("/project/lib.js", "export {value} from './b.js';")]);

  assert!(!hmr.reloaded());
  assert_eq!(
    hmr.outputs(),
    vec![
      serde_json::json!(["index", "from-a"]),
      serde_json::json!(["index", "from-b"]),
    ]
  );
}
