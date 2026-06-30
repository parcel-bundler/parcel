use indexmap::{IndexMap, IndexSet};
use parcel_core::{
  Asset, AssetType, BundleGraph, OutputFormat, ParcelConfig, ParcelOptions, get_bundle_content,
};
use parcel_js::packager::{Resolution, SyntheticAsset, asset_dependencies};
use std::{
  collections::{HashMap, HashSet},
  fmt::Write,
  fs::File,
  path::Path,
  sync::{Arc, Mutex},
  thread,
};
use tiny_http::{Header, ReadWrite, Response, Server};
use tungstenite::{Message, WebSocket};
use url::Url;

#[derive(serde::Serialize, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum HmrUpdate<'a> {
  Update { assets: Vec<HmrAsset<'a>> },
}

#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
enum Id {
  Asset(String),
  Bundle(String),
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HmrAsset<'a> {
  id: Id,
  #[serde(rename = "type")]
  ty: AssetType,
  output: String,
  env_hash: String,
  output_format: OutputFormat,
  deps_by_bundle: HashMap<String, IndexMap<String, Resolution<'a>>>,
}

pub struct DevServer {
  sockets: Arc<Mutex<Vec<WebSocket<Box<dyn ReadWrite + Send>>>>>,
}

pub fn serve_dir(path: &Path) -> DevServer {
  let path = path.to_owned();
  let sockets = Arc::new(Mutex::new(Vec::new()));
  let sockets_clone = Arc::clone(&sockets);
  std::thread::spawn(move || {
    let server = Server::http("127.0.0.1:1234").unwrap();
    println!("Server listening on http://localhost:1234");

    for request in server.incoming_requests() {
      if is_websocket_upgrade(&request) {
        let ws_key = request
          .headers()
          .iter()
          .find(|h| h.field.equiv("Sec-WebSocket-Key"))
          .map(|h| h.value.as_str());
        let mut response = Response::empty(101);
        response.add_header(Header::from_bytes(b"Upgrade", b"websocket").unwrap());
        response.add_header(Header::from_bytes(b"Connection", b"Upgrade").unwrap());
        if let Some(key) = ws_key {
          let accept_key = tungstenite::handshake::derive_accept_key(key.as_bytes());
          response.add_header(
            Header::from_bytes(b"Sec-WebSocket-Accept", accept_key.as_bytes()).unwrap(),
          );
        }

        let stream = request.upgrade("websocket", response);
        let clients_clone = Arc::clone(&sockets_clone);
        thread::spawn(move || {
          let websocket = tungstenite::WebSocket::from_raw_socket(
            stream,
            tungstenite::protocol::Role::Server,
            None,
          );
          clients_clone.lock().unwrap().push(websocket);
        });
        continue;
      }

      let base_url = Url::parse("http://localhost").unwrap();
      let url = base_url.join(request.url()).unwrap();
      let mut full_path = path.clone();
      for segment in url.path_segments().unwrap() {
        full_path.push(
          percent_encoding::percent_decode(segment.as_bytes())
            .decode_utf8()
            .unwrap()
            .as_ref(),
        );
      }

      if full_path.is_dir() {
        full_path.push("index.html");
      }

      if full_path.is_file() && full_path.starts_with(&path) {
        let file = File::open(&full_path).unwrap();
        let ty = full_path
          .extension()
          .map(|e| AssetType::from_extension(e.to_str().unwrap()).mime())
          .unwrap_or("application/octet-stream");
        let response = Response::from_file(file)
          .with_header(Header::from_bytes(b"Content-Type", ty.as_bytes()).unwrap());

        request.respond(response).unwrap();
      } else {
        let response = Response::from_string("404 not found").with_status_code(404);
        request.respond(response).unwrap();
      }
    }
  });

  DevServer { sockets }
}

fn is_websocket_upgrade(request: &tiny_http::Request) -> bool {
  request
    .headers()
    .iter()
    .any(|h| h.field.equiv("Upgrade") && h.value.as_str().eq_ignore_ascii_case("websocket"))
}

impl DevServer {
  pub fn emit_hmr_update(
    &self,
    changed_assets: Vec<(u32, &Asset)>,
    bundle_graph: &BundleGraph,
    config: &ParcelConfig,
    options: &ParcelOptions,
  ) {
    let update = get_hmr_update(changed_assets, bundle_graph, config, options);
    let serialized = serde_json::to_string(&update).unwrap();

    let mut sockets = self.sockets.lock().unwrap();
    sockets.retain_mut(|ws| {
      match ws.send(Message::Text(serialized.clone().into())) {
        Ok(_) => true,   // Keep the client
        Err(_) => false, // Drop the client (they disconnected)
      }
    });
  }
}

pub(crate) fn get_hmr_update<'a>(
  changed_assets: Vec<(u32, &'a Asset)>,
  bundle_graph: &'a BundleGraph,
  config: &'a ParcelConfig,
  options: &'a ParcelOptions,
) -> HmrUpdate<'a> {
  let mut synthetic_assets = IndexSet::new();
  let mut assets = Vec::with_capacity(changed_assets.len());
  for (id, asset) in changed_assets {
    let dependencies = asset_dependencies(
      id as usize,
      asset,
      bundle_graph,
      None,
      &mut synthetic_assets,
      &|bundle_index| {
        get_bundle_content(
          config,
          bundle_graph,
          &bundle_graph.bundles[bundle_index],
          options,
        )
      },
      &bundle_graph.project_root,
    )
    .unwrap();

    // TODO: I think we don't need this anymore. Was added in https://github.com/parcel-bundler/parcel/pull/4311
    // due to runtimes producing different dependencies per bundle.
    let mut deps_by_bundle = HashMap::new();
    deps_by_bundle.insert("TODO".into(), dependencies);

    let mut output = String::new();
    if asset.ty == AssetType::Js {
      output = format!(
        "parcelHotUpdate['{}'] = function (require, module, exports) {{{}}}",
        asset.id(&bundle_graph.project_root),
        String::from_utf8(asset.content.read().unwrap()).unwrap()
      );
    }

    assets.push(HmrAsset {
      id: Id::Asset(asset.id(&bundle_graph.project_root)),
      ty: asset.ty.clone(),
      output,
      // TODO: needed to filter out assets that come from a different target, preventing page reload.
      env_hash: "TODO".into(),
      output_format: asset.target.output_format.clone(),
      deps_by_bundle,
    });
  }

  // TODO: only changed ones??
  for synthetic_asset in synthetic_assets {
    let id = if let SyntheticAsset::Asset(id, _) = &synthetic_asset {
      Id::Asset(id.clone())
    } else {
      Id::Bundle(synthetic_asset.id())
    };

    let mut output = String::new();
    write!(&mut output, "parcelHotUpdate[").unwrap();
    synthetic_asset.write_id(&mut output).unwrap();
    write!(&mut output, "] = function (require, module, exports) {{").unwrap();
    synthetic_asset
      .write_content(
        &mut output,
        bundle_graph,
        &bundle_graph.bundles[0], // TODO
        &|bundle_index| {
          get_bundle_content(
            config,
            bundle_graph,
            &bundle_graph.bundles[bundle_index],
            options,
          )
        },
        &bundle_graph.project_root,
      )
      .unwrap();
    write!(&mut output, "}}").unwrap();

    let mut deps_by_bundle = HashMap::new();
    deps_by_bundle.insert(
      "TODO".into(),
      synthetic_asset.dependencies(bundle_graph, &bundle_graph.project_root),
    );

    assets.push(HmrAsset {
      id,
      ty: AssetType::Js,
      output,
      env_hash: "TODO".into(),
      output_format: OutputFormat::Esmodule,
      deps_by_bundle,
    });
  }

  HmrUpdate::Update { assets }
}

#[cfg(test)]
mod tests {
  use super::*;
  use parcel_core::{
    AssetNode, BuildMode, BuildOptions, Environment, FileSystem, LogLevel, MemoryFileSystem,
    Parcel, PathId,
  };
  use parcel_plugin_js::create_runtime;
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
      env: HashMap::new(),
      log_level: LogLevel::Error,
      input_fs: input_fs.clone(),
      output_fs,
      config: None,
      cwd: PathId::new(Path::new("/project")),
    };

    let entries = vec!["/project/index.js".to_string()];
    let mut parcel = crate::make_parcel(&entries, options).expect("Parcel::new failed");
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
    let graph = build_result.bundle_graph;
    let changed_assets = build_result
      .changed_assets
      .iter()
      .filter_map(|&index| {
        if let AssetNode::Asset(asset) = &graph.asset_graph.assets[index] {
          Some((index as u32, asset))
        } else {
          None
        }
      })
      .collect();

    let update = get_hmr_update(changed_assets, &graph, &config, &options);
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
      let graph = build_result.bundle_graph;
      let changed_assets = build_result
        .changed_assets
        .iter()
        .filter_map(|&index| {
          if let AssetNode::Asset(asset) = &graph.asset_graph.assets[index] {
            Some((index as u32, asset))
          } else {
            None
          }
        })
        .collect();

      let update = get_hmr_update(changed_assets, &graph, &config, &options);
      let update_result = self.js_env.context.with(|ctx| -> rquickjs::Result<()> {
        let update = serde_json::to_string(&update).unwrap();
        let _: Value = ctx.eval(format!(
          "globalThis.__parcel_hmr_test__.handleMessage({})",
          update
        ))?;
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
  fn generated_runtime_applies_hmr_update_with_new_dependency() {
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
  fn generated_runtime_supports_self_accepting_updates() {
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
  fn generated_runtime_bubbles_updates_to_accepting_parents() {
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
  fn generated_runtime_calls_dispose_callbacks() {
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
  fn generated_runtime_handles_circular_dependencies() {
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
  fn generated_runtime_updates_across_dynamic_import_bundle() {
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
  fn generated_runtime_updates_module_containing_dynamic_import() {
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
  fn generated_runtime_reloads_when_update_is_not_accepted() {
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
  fn generated_runtime_reloads_when_entry_is_updated_without_accepting() {
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
  fn generated_runtime_updates_modules_with_multiple_parents() {
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
  fn generated_runtime_reloads_if_only_one_parent_accepts() {
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
  fn generated_runtime_accept_callback_can_bubble_to_additional_parents() {
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
  fn generated_runtime_reloads_when_additional_parent_bubbling_is_not_accepted() {
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
}
