#[path = "../../core/tests/support/mod.rs"]
mod test_utils;

use std::{borrow::Cow, collections::HashMap, path::Path, sync::Arc, time::Duration};

use parcel_core::{
  Asset, AssetFlags, AssetGraph, AssetIndex, AssetNode, AssetNodeIndex, AssetType, BufferContent,
  BuildSuccess, Bundle, BundleBehavior, BundleFlags, BundleGraph, BundleGraphDependencyResolution,
  Dependency, DependencyFlags, DependencyId, DependencyResolution, Diagnostic, DiagnosticList,
  Environment, ExportsCondition, FileSystem, ImportType, LogEvent, LogLevel, LogMessage,
  OverlayFileSystem, ParcelOptions, PathId, Priority, Reporter, ReporterEvent, SourceLocation,
  SourceUrl, SpecifierType, Target,
};
use parcel_plugin_js::JsPlugin;

/// Runs `code` as a reporter plugin against `event`.
///
/// The plugin signals what it saw by throwing: a returned `Err` carries the
/// assertion message, so a wrong event shape fails the test with the JS
/// assertion rather than silently passing.
fn report(name: &str, code: &str, event: &ReporterEvent) -> Result<(), DiagnosticList> {
  report_with_config(name, code, event, None)
}

fn report_with_config(
  name: &str,
  code: &str,
  event: &ReporterEvent,
  config: Option<serde_json::Value>,
) -> Result<(), DiagnosticList> {
  report_times(name, code, event, config, 1)
}

/// Reports `event` `times` times against one plugin instance, so a test can
/// observe what the plugin retained between calls.
fn report_times(
  name: &str,
  code: &str,
  event: &ReporterEvent,
  config: Option<serde_json::Value>,
  times: usize,
) -> Result<(), DiagnosticList> {
  report_with_output_fs(
    name,
    code,
    event,
    config,
    times,
    Arc::new(OverlayFileSystem::new()),
  )
}

/// Like `report_times`, with `output_fs` as the build's output file system.
fn report_with_output_fs(
  name: &str,
  code: &str,
  event: &ReporterEvent,
  config: Option<serde_json::Value>,
  times: usize,
  output_fs: Arc<dyn FileSystem>,
) -> Result<(), DiagnosticList> {
  let fs = Arc::new(OverlayFileSystem::new());
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  let plugin_path = root.join(Path::new(name));
  fs.create_dir_all(root).expect("Error creating dir");
  fs.write(plugin_path, &test_utils::js(code).as_bytes().to_owned())
    .expect("Error writing file");

  let plugin_dir = root.join(Path::new("node_modules/@parcel/plugin"));
  fs.create_dir_all(plugin_dir)
    .expect("Error creating plugin dir");
  fs.write(
    plugin_dir.child("package.json"),
    &br#"{"main":"index.js"}"#.to_vec(),
  )
  .expect("Error writing plugin package");
  fs.write(
    plugin_dir.child("index.js"),
    &br#"
      const CONFIG = Symbol.for('parcel.plugin.v3.reporter');
      class Reporter { constructor(opts) { this[CONFIG] = opts; } }
      module.exports = {Reporter};
    "#
    .to_vec(),
  )
  .expect("Error writing plugin API");

  let plugin = JsPlugin::new(plugin_path, "test-plugin", config);
  let options = ParcelOptions {
    input_fs: fs,
    output_fs,
    ..Default::default()
  };
  (0..times)
    .map(|_| plugin.report(event, &options))
    .collect::<Result<Vec<()>, DiagnosticList>>()
    .map(|_| ())
}

fn bundle_graph() -> BundleGraph<'static> {
  let target = Arc::new(Target {
    dist_dir: PathId::new(test_utils::path("/dist").as_path()),
    public_url: "/assets".into(),
    ..Default::default()
  });
  let assets = vec![
    test_asset(
      test_utils::url("file:///src/index.js").as_str(),
      AssetType::Js,
      target.clone(),
    ),
    test_asset(
      test_utils::url("file:///src/style.css").as_str(),
      AssetType::Css,
      target.clone(),
    ),
  ];
  let bundles = vec![Bundle {
    id: 0,
    ty: AssetType::Js,
    target,
    bundle_behavior: BundleBehavior::None,
    flags: BundleFlags::ENTRY,
    dist_path: None,
    assets: vec![AssetIndex(0)],
    entry_assets: vec![AssetIndex(0)],
    main_entry_asset: Some(AssetIndex(0)),
    referenced_bundles: vec![],
    name_state: Default::default(),
  }];

  BundleGraph::new(
    AssetGraph {
      asset_nodes: Cow::Owned(
        assets
          .iter()
          .enumerate()
          .map(|(index, asset)| AssetNode::from_asset(AssetIndex::from_index(index), asset))
          .collect(),
      ),
      assets: Cow::Owned(assets),
      entries: Cow::Owned(vec![]),
    },
    bundles,
    HashMap::new(),
    PathId::new(test_utils::path("/").as_path()),
  )
}

fn test_asset(url: &str, ty: AssetType, target: Arc<Target>) -> Asset {
  Asset {
    loc: SourceLocation {
      url: SourceUrl::parse(&test_utils::url(url)).unwrap(),
      ..Default::default()
    },
    ty,
    content: Arc::new(BufferContent::new(vec![])),
    target,
    pipeline: None,
    bundle_behavior: BundleBehavior::None,
    flags: AssetFlags::empty(),
    unique_key: None,
    dependencies: vec![],
    symbols: Default::default(),
  }
}

#[test]
fn test_reporter_build_start() {
  report(
    "reporter-start.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import assert from 'assert';

      export default new Reporter({
        buildStart({config, options}) {
          // Destructuring throws unless it was called with an object, so this
          // fails the test if buildStart is handed nothing.
          assert.equal(config, undefined);
          assert.equal(options.mode, 'development');
        }
      });
    "#,
    &ReporterEvent::BuildStart,
  )
  .expect("buildStart");
}

#[test]
fn test_reporter_build_success() {
  let graph = bundle_graph();
  report(
    "reporter-success.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import assert from 'assert';

      export default new Reporter({
        buildSuccess({bundleGraph, buildTime, changedAssets, options}) {
          assert.equal(options.mode, 'development');
          assert.equal(typeof buildTime, 'number');
          assert.equal(buildTime, 1500);

          let bundles = bundleGraph.getBundles();
          assert.equal(bundles.length, 1);
          assert.equal(bundles[0].type, 'js');
          assert.equal(bundles[0].getMainEntry().url, testUrl('file:///src/index.js'));

          assert.equal(changedAssets.length, 1);
          assert.equal(changedAssets[0].url, testUrl('file:///src/style.css'));
          assert.equal(changedAssets[0].type, 'css');
        }
      });
    "#,
    &ReporterEvent::BuildSuccess(BuildSuccess {
      bundle_graph: &graph,
      changed_assets: &[AssetIndex(1)],
      build_time: Duration::from_millis(1500),
    }),
  )
  .expect("buildSuccess");
}

#[test]
fn test_reporter_file_path_of_bundles_that_are_not_content_hashed() {
  let mut graph = bundle_graph();
  // Written to the namer's path, so it never gets a final path of its own.
  graph.bundles[0].dist_path = Some(PathId::new(test_utils::path("/dist/index.js").as_path()));
  report(
    "reporter-file-path.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import assert from 'assert';

      export default new Reporter({
        buildSuccess({bundleGraph}) {
          assert.equal(bundleGraph.getBundles()[0].filePath, testPath('/dist/index.js'));
        }
      });
    "#,
    &ReporterEvent::BuildSuccess(BuildSuccess {
      bundle_graph: &graph,
      changed_assets: &[],
      build_time: Duration::ZERO,
    }),
  )
  .expect("buildSuccess");
}

/// An entry bundle that lazily loads a second bundle, through a dependency the bundler resolved
/// to that bundle. Only the entry has its final path.
fn lazy_bundle_graph() -> BundleGraph<'static> {
  let target = Arc::new(Target {
    dist_dir: PathId::new(test_utils::path("/dist").as_path()),
    ..Default::default()
  });
  let server_target = Arc::new(Target {
    dist_dir: PathId::new(test_utils::path("/dist").as_path()),
    environment: Environment::Node,
    ..Default::default()
  });
  let lazy = |specifier: &str, flags| Dependency {
    specifier: specifier.into(),
    specifier_type: SpecifierType::Esm,
    priority: Priority::Lazy,
    bundle_behavior: BundleBehavior::None,
    import_type: ImportType::JavaScript,
    flags,
    concurrent_group: 0,
    custom_conditions: Default::default(),
    target: target.clone(),
    loc: None,
    placeholder: None,
    resolve_from: None,
    range: None,
    conditions: ExportsCondition::empty(),
    resolution: DependencyResolution::Asset(AssetNodeIndex(1)),
  };
  let mut index = test_asset(
    test_utils::url("file:///src/index.js").as_str(),
    AssetType::Js,
    target.clone(),
  );
  index.dependencies = vec![
    lazy("./lazy", DependencyFlags::SIDE_EFFECTS),
    lazy("./lazy?again", DependencyFlags::empty()),
  ];
  let assets = vec![
    index,
    test_asset(
      test_utils::url("file:///src/lazy.js").as_str(),
      AssetType::Js,
      server_target.clone(),
    ),
  ];
  let bundles = vec![
    Bundle {
      id: 1,
      ty: AssetType::Js,
      target,
      bundle_behavior: BundleBehavior::None,
      flags: BundleFlags::ENTRY,
      dist_path: Some(PathId::new(test_utils::path("/dist/index.js").as_path())),
      assets: vec![AssetIndex(0)],
      entry_assets: vec![AssetIndex(0)],
      main_entry_asset: Some(AssetIndex(0)),
      referenced_bundles: vec![],
      name_state: Default::default(),
    },
    Bundle {
      id: 2,
      ty: AssetType::Js,
      target: server_target,
      bundle_behavior: BundleBehavior::None,
      flags: BundleFlags::empty(),
      dist_path: None,
      assets: vec![AssetIndex(1)],
      entry_assets: vec![AssetIndex(1)],
      main_entry_asset: Some(AssetIndex(1)),
      referenced_bundles: vec![],
      name_state: Default::default(),
    },
  ];
  bundles[0].set_final_path(PathId::new(test_utils::path("/dist/index.js").as_path()));

  let mut resolutions = HashMap::new();
  // Only the first dependency was resolved to the lazy bundle; the second keeps its asset
  // resolution, as if it had been internalized.
  resolutions.insert(
    DependencyId {
      asset: AssetIndex(0),
      dependency: 0,
    },
    BundleGraphDependencyResolution::Bundle {
      bundle_index: 1,
      asset_index: AssetIndex(1),
    },
  );

  BundleGraph::new(
    AssetGraph {
      asset_nodes: Cow::Owned(
        assets
          .iter()
          .enumerate()
          .map(|(index, asset)| AssetNode::from_asset(AssetIndex::from_index(index), asset))
          .collect(),
      ),
      assets: Cow::Owned(assets),
      entries: Cow::Owned(vec![]),
    },
    bundles,
    resolutions,
    PathId::new(test_utils::path("/").as_path()),
  )
}

#[test]
fn test_reporter_bundle_graph_queries() {
  let graph = lazy_bundle_graph();
  report(
    "reporter-graph-queries.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import assert from 'assert';

      export default new Reporter({
        buildSuccess({bundleGraph}) {
          let [entry, lazy] = bundleGraph.getBundles();
          let [index, lazyAsset] = [entry.getMainEntry(), lazy.getMainEntry()];

          assert.equal(entry.filePath, testPath('/dist/index.js'));
          assert.equal(entry.name, 'index.js');
          assert.equal(lazy.filePath, null);
          assert.equal(lazy.name, null);

          assert.equal(entry.hasAsset(index), true);
          assert.equal(entry.hasAsset(lazyAsset), false);

          assert.equal(entry.target.isServer(), false);
          assert.equal(lazy.target.isServer(), true);
          assert.equal(lazy.target.isWorklet(), false);

          let [dep, internalized] = index.getDependencies();
          assert.equal(dep.sideEffects, true);
          assert.equal(internalized.sideEffects, false);

          assert.equal(bundleGraph.getResolvedAsset(dep).url, testUrl('file:///src/lazy.js'));
          assert.equal(bundleGraph.getResolvedAsset(internalized).url, testUrl('file:///src/lazy.js'));
          assert.equal(bundleGraph.getReferencedBundle(dep).getMainEntry().url, testUrl('file:///src/lazy.js'));
          assert.equal(bundleGraph.getReferencedBundle(internalized), undefined);

          let dependencies = bundleGraph.getBundleDependencies(entry);
          assert.deepEqual(dependencies.map(b => b.getMainEntry().url), [testUrl('file:///src/lazy.js')]);
          assert.deepEqual(bundleGraph.getBundleDependencies(lazy), []);

          let group = bundleGraph.getBundlesInBundleGroup(entry);
          assert.deepEqual(group.map(b => b.getMainEntry().url), [testUrl('file:///src/lazy.js')]);
        }
      });
    "#,
    &ReporterEvent::BuildSuccess(BuildSuccess {
      bundle_graph: &graph,
      changed_assets: &[],
      build_time: Duration::ZERO,
    }),
  )
  .expect("bundle graph queries");
}

#[test]
fn test_reporter_build_failure() {
  let diagnostics = DiagnosticList(vec![Diagnostic {
    message: "it did not work".into(),
    origin: Some("@acme/plugin".into()),
    hints: vec!["try something else".into()],
    ..Diagnostic::from_message(String::new())
  }]);

  report(
    "reporter-failure.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import assert from 'assert';

      export default new Reporter({
        buildFailure({diagnostics}) {
          assert.equal(diagnostics.length, 1);
          assert.equal(diagnostics[0].severity, 'error');
          assert.equal(diagnostics[0].message, 'it did not work');
          assert.equal(diagnostics[0].origin, '@acme/plugin');
          assert.deepEqual(diagnostics[0].hints, ['try something else']);
        }
      });
    "#,
    &ReporterEvent::BuildFailure {
      diagnostics: &diagnostics,
    },
  )
  .expect("buildFailure");
}

#[test]
fn test_reporter_log_message() {
  report(
    "reporter-log.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import assert from 'assert';

      export default new Reporter({
        log({level, message, diagnostics}) {
          assert.equal(level, 'warn');
          assert.equal(message, 'something to say');
          assert.equal(diagnostics, undefined);
        }
      });
    "#,
    &ReporterEvent::Log(LogEvent {
      level: LogLevel::Warn,
      message: LogMessage::Text("something to say"),
    }),
  )
  .expect("log");
}

#[test]
fn test_reporter_log_diagnostics() {
  let diagnostics = vec![Diagnostic::from_message("worth knowing".into())];
  report(
    "reporter-log-diagnostics.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import assert from 'assert';

      export default new Reporter({
        log({level, message, diagnostics}) {
          assert.equal(level, 'verbose');
          assert.equal(message, undefined);
          assert.equal(diagnostics.length, 1);
          assert.equal(diagnostics[0].message, 'worth knowing');
        }
      });
    "#,
    &ReporterEvent::Log(LogEvent {
      level: LogLevel::Verbose,
      message: LogMessage::Diagnostics(&diagnostics),
    }),
  )
  .expect("log with diagnostics");
}

#[test]
fn test_reporter_config_and_async() {
  report_with_config(
    "reporter-config.cjs",
    r#"
      const {Reporter} = require('@parcel/plugin');
      const assert = require('assert');

      module.exports = new Reporter({
        async buildStart({config}) {
          await Promise.resolve();
          assert.deepEqual(config, {verbose: true});
        }
      });
    "#,
    &ReporterEvent::BuildStart,
    Some(serde_json::json!({"verbose": true})),
  )
  .expect("config and async");
}

#[test]
fn test_reporter_failure_is_reported() {
  let error = report(
    "reporter-throws.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      export default new Reporter({
        buildStart() { throw new Error('reporter blew up'); }
      });
    "#,
    &ReporterEvent::BuildStart,
  )
  .expect_err("a throwing reporter reports the error");

  assert!(
    error.0[0].message.contains("reporter blew up"),
    "got: {}",
    error.0[0].message
  );
}

#[test]
fn test_reporter_wrappers_expire_after_the_call() {
  let graph = bundle_graph();
  // The graph handed to a reporter is borrowed for the duration of the call,
  // exactly as it is for a namer or optimizer. The counter rules out the test
  // passing because the module was reloaded and `saved` was simply never set.
  report_times(
    "reporter-escape.cjs",
    r#"
      const {Reporter} = require('@parcel/plugin');
      const assert = require('assert');

      let saved;
      let calls = 0;
      module.exports = new Reporter({
        buildSuccess({bundleGraph}) {
          calls++;
          if (calls === 1) {
            saved = bundleGraph.getBundles()[0];
            return;
          }
          assert.ok(saved, 'the plugin should have kept its handle between calls');
          assert.throws(() => saved.type, /plugin call has completed/);
        }
      });
    "#,
    &ReporterEvent::BuildSuccess(BuildSuccess {
      bundle_graph: &graph,
      changed_assets: &[],
      build_time: Duration::ZERO,
    }),
    None,
    2,
  )
  .expect("the handle from the first call expires by the second");
}

#[test]
fn test_events_a_reporter_does_not_implement_are_skipped() {
  // Implements only `buildFailure`; every other method throws if it is ever
  // reached, so a skipped event that was not actually skipped fails the test.
  const CODE: &str = r#"
    import {Reporter} from '@parcel/plugin';

    export default new Reporter({
      buildFailure() {},
      // buildStart and log are deliberately absent.
    });
  "#;

  let graph = bundle_graph();
  report("reporter-partial.mjs", CODE, &ReporterEvent::BuildStart).expect("buildStart is skipped");

  report(
    "reporter-partial.mjs",
    CODE,
    &ReporterEvent::BuildSuccess(BuildSuccess {
      bundle_graph: &graph,
      changed_assets: &[],
      build_time: Duration::ZERO,
    }),
  )
  .expect("buildSuccess is skipped");

  report(
    "reporter-partial.mjs",
    CODE,
    &ReporterEvent::Log(LogEvent {
      level: LogLevel::Info,
      message: LogMessage::Text("ignored"),
    }),
  )
  .expect("log is skipped");
}

#[test]
fn test_a_reporter_with_no_known_methods_is_reported_once() {
  // The shape a Parcel v2 reporter has: a single `report` method, which this
  // API no longer calls. Silently doing nothing would be the worst outcome.
  const CODE: &str = r#"
    import {Reporter} from '@parcel/plugin';
    export default new Reporter({
      report() { throw new Error('this should never be called'); }
    });
  "#;

  let error = report_times(
    "reporter-v2-shape.mjs",
    CODE,
    &ReporterEvent::BuildStart,
    None,
    1,
  )
  .expect_err("a reporter that implements nothing is an error");

  let message = &error.0[0].message;
  assert!(message.contains("exports none of"), "got: {message}");
  for name in ["buildStart", "buildSuccess", "buildFailure", "log"] {
    assert!(message.contains(name), "{name} missing from: {message}");
  }
}

#[test]
fn test_the_method_set_is_resolved_once() {
  // `log` is a getter that fails the second time it is read. Resolving the
  // method set on every event would trip it — this is what makes skipping an
  // unimplemented event cheaper than calling it.
  let error = report_times(
    "reporter-probe-once.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';

      let probes = 0;
      export default new Reporter({
        buildStart() {},
        get log() {
          if (++probes > 1) {
            throw new Error('the method set was resolved more than once');
          }
          return undefined;
        }
      });
    "#,
    &ReporterEvent::Log(LogEvent {
      level: LogLevel::Info,
      message: LogMessage::Text("ignored"),
    }),
    None,
    5,
  );

  assert!(
    error.is_ok(),
    "five skipped log events probed the plugin more than once: {error:?}"
  );
}

#[test]
fn test_reporter_write_file() {
  let output_fs = Arc::new(OverlayFileSystem::new());
  let dir = test_utils::path("/_parcel_out");
  output_fs
    .create_dir_all(PathId::new(&dir))
    .expect("Error creating dir");
  report_with_output_fs(
    "reporter-write-file.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import fs from 'fs';
      import fsPromises from 'fs/promises';
      import assert from 'assert';

      export default new Reporter({
        async buildStart() {
          fs.writeFileSync(testPath('/_parcel_out/sync.txt'), 'sync');
          fs.writeFileSync(testPath('/_parcel_out/buffer.txt'), Buffer.from('buffer'));
          fs.writeFileSync(testPath('/_parcel_out/hex.txt'), '6869', 'hex');
          fs.writeFileSync(testPath('/_parcel_out/view.txt'), new Uint8Array([0, 118, 105, 101, 119]).subarray(1));
          fs.writeFileSync(testPath('/_parcel_out/options.txt'), 'b3B0aW9ucw==', {encoding: 'base64'});

          let called = false;
          fs.writeFile(testPath('/_parcel_out/callback.txt'), 'callback', err => {
            called = true;
            assert.equal(err, null);
          });
          assert.equal(called, true);

          await fsPromises.writeFile(testPath('/_parcel_out/promise.txt'), 'promise');
          await fs.promises.writeFile(testPath('/_parcel_out/promises.txt'), 'promises', 'utf8');

          // Writes don't go to the input file system.
          assert.equal(fs.existsSync(testPath('/_parcel_out/sync.txt')), false);

          assert.throws(() => fs.writeFileSync(testPath('/_parcel_out/missing/file.txt'), 'x'), {code: 'ENOENT'});
          assert.throws(() => fs.writeFileSync(testPath('/_parcel_out/bad.txt'), 42), TypeError);
          await assert.rejects(fsPromises.writeFile(testPath('/_parcel_out/missing/file.txt'), 'x'), {code: 'ENOENT'});
          await assert.rejects(fsPromises.writeFile(testPath('/_parcel_out/bad.txt'), 42), TypeError);
        }
      });
    "#,
    &ReporterEvent::BuildStart,
    None,
    1,
    output_fs.clone(),
  )
  .expect("buildStart");

  let read = |name: &str| {
    output_fs
      .read_to_string(PathId::new(&dir.join(name)))
      .unwrap_or_else(|err| panic!("{name}: {err}"))
  };
  assert_eq!(read("sync.txt"), "sync");
  assert_eq!(read("buffer.txt"), "buffer");
  assert_eq!(read("hex.txt"), "hi");
  assert_eq!(read("view.txt"), "view");
  assert_eq!(read("options.txt"), "options");
  assert_eq!(read("callback.txt"), "callback");
  assert_eq!(read("promise.txt"), "promise");
  assert_eq!(read("promises.txt"), "promises");
}

#[test]
fn test_reporter_copy_file_and_unlink() {
  let output_fs = Arc::new(OverlayFileSystem::new());
  let dir = test_utils::path("/_parcel_out");
  output_fs
    .create_dir_all(PathId::new(&dir))
    .expect("Error creating dir");
  for name in [
    "src.txt",
    "unlink-sync.txt",
    "unlink-callback.txt",
    "unlink-promise.txt",
  ] {
    output_fs
      .write(PathId::new(&dir.join(name)), name.as_bytes())
      .expect("Error writing file");
  }
  report_with_output_fs(
    "reporter-copy-unlink.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import fs from 'fs';
      import fsPromises from 'fs/promises';
      import assert from 'assert';

      const out = name => testPath('/_parcel_out/' + name);

      export default new Reporter({
        async buildStart() {
          fs.copyFileSync(out('src.txt'), out('copy-sync.txt'));
          fs.copyFileSync(out('src.txt'), out('copy-sync.txt'));

          let called = false;
          fs.copyFile(out('src.txt'), out('copy-callback.txt'), err => {
            called = true;
            assert.equal(err, null);
          });
          assert.equal(called, true);

          await fsPromises.copyFile(out('src.txt'), out('copy-promise.txt'));
          await fs.promises.copyFile(out('src.txt'), out('copy-excl.txt'), fs.constants.COPYFILE_EXCL);

          assert.throws(() => fs.copyFileSync(out('src.txt'), out('copy-excl.txt'), fs.constants.COPYFILE_EXCL), {code: 'EEXIST'});
          assert.throws(() => fs.copyFileSync(out('missing.txt'), out('copy-missing.txt')), {code: 'ENOENT', syscall: 'copyfile'});
          await assert.rejects(fsPromises.copyFile(out('missing.txt'), out('copy-missing.txt')), {code: 'ENOENT'});
          await assert.rejects(fsPromises.copyFile(out('src.txt'), out('copy-bad.txt'), 'x'), TypeError);

          fs.unlinkSync(out('unlink-sync.txt'));
          called = false;
          fs.unlink(out('unlink-callback.txt'), err => {
            called = true;
            assert.equal(err, null);
          });
          assert.equal(called, true);
          await fsPromises.unlink(out('unlink-promise.txt'));

          assert.throws(() => fs.unlinkSync(out('unlink-sync.txt')), {code: 'ENOENT', syscall: 'unlink'});
          await assert.rejects(fs.promises.unlink(out('unlink-sync.txt')), {code: 'ENOENT'});
        }
      });
    "#,
    &ReporterEvent::BuildStart,
    None,
    1,
    output_fs.clone(),
  )
  .expect("buildStart");

  let read = |name: &str| output_fs.read_to_string(PathId::new(&dir.join(name)));
  for name in [
    "copy-sync.txt",
    "copy-callback.txt",
    "copy-promise.txt",
    "copy-excl.txt",
  ] {
    assert_eq!(
      read(name).unwrap_or_else(|err| panic!("{name}: {err}")),
      "src.txt"
    );
  }
  for name in [
    "unlink-sync.txt",
    "unlink-callback.txt",
    "unlink-promise.txt",
    "copy-missing.txt",
    "copy-bad.txt",
  ] {
    assert!(read(name).is_err(), "{name} should not exist");
  }
  assert_eq!(read("src.txt").unwrap(), "src.txt");
}

#[test]
fn test_reporter_mkdir_rmdir_rm() {
  let output_fs = Arc::new(OverlayFileSystem::new());
  let dir = test_utils::path("/_parcel_out");
  output_fs
    .create_dir_all(PathId::new(&dir))
    .expect("Error creating dir");
  report_with_output_fs(
    "reporter-mkdir-rm.mjs",
    r#"
      import {Reporter} from '@parcel/plugin';
      import fs from 'fs';
      import fsPromises from 'fs/promises';
      import assert from 'assert';

      const out = name => testPath('/_parcel_out/' + name);

      export default new Reporter({
        async buildStart() {
          // mkdir
          assert.equal(fs.mkdirSync(out('a')), undefined);
          assert.throws(() => fs.mkdirSync(out('a')), {code: 'EEXIST', syscall: 'mkdir'});
          assert.throws(() => fs.mkdirSync(out('missing/b')), {code: 'ENOENT'});
          assert.equal(fs.mkdirSync(out('a/b/c'), {recursive: true}), out('a/b'));
          assert.equal(fs.mkdirSync(out('a/b/c'), {recursive: true}), undefined);
          assert.equal(fs.mkdirSync(out('mode'), 0o755), undefined);

          let called = false;
          fs.mkdir(out('callback'), err => {
            called = true;
            assert.equal(err, null);
          });
          assert.equal(called, true);
          called = false;
          fs.mkdir(out('callback-r/x'), {recursive: true}, (err, path) => {
            called = true;
            assert.equal(err, null);
            assert.equal(path, out('callback-r'));
          });
          assert.equal(called, true);
          assert.equal(await fsPromises.mkdir(out('promise')), undefined);
          assert.equal(await fs.promises.mkdir(out('promise-r/x/y'), {recursive: true}), out('promise-r'));
          await assert.rejects(fsPromises.mkdir(out('promise')), {code: 'EEXIST'});
          await assert.rejects(fsPromises.mkdir(out('bad'), {recursive: 1}), TypeError);
          for (let name of ['a/b/c', 'callback', 'callback-r/x', 'promise', 'promise-r/x/y']) {
            assert.equal(fs.existsSync(out(name)), false, 'mkdir should not write to the input fs');
          }

          // rmdir
          fs.writeFileSync(out('a/file.txt'), 'x');
          assert.throws(() => fs.rmdirSync(out('a')), {code: 'ENOTEMPTY', syscall: 'rmdir'});
          assert.throws(() => fs.rmdirSync(out('a/file.txt')), {code: 'ENOTDIR'});
          fs.rmdirSync(out('a/b/c'));
          called = false;
          fs.rmdir(out('a/b'), err => {
            called = true;
            assert.equal(err, null);
          });
          assert.equal(called, true);
          await fsPromises.rmdir(out('promise'));
          await assert.rejects(fsPromises.rmdir(out('promise')), {code: 'ENOENT'});
          fs.rmdirSync(out('callback-r'), {recursive: true});

          // rm
          assert.throws(() => fs.rmSync(out('a')), {code: 'ERR_FS_EISDIR'});
          assert.throws(() => fs.rmSync(out('nope')), {code: 'ENOENT', syscall: 'rm'});
          fs.rmSync(out('nope'), {force: true});
          fs.rmSync(out('a/file.txt'));
          fs.rmSync(out('a'), {recursive: true});
          fs.rm(out('mode'), {recursive: true}, err => assert.equal(err, null));
          fs.rm(out('callback'), err => assert.equal(err.code, 'ERR_FS_EISDIR'));
          await fsPromises.rm(out('promise-r'), {recursive: true, force: true});
          await fs.promises.rm(out('promise-r'), {force: true});
          await assert.rejects(fsPromises.rm(out('promise-r')), {code: 'ENOENT'});
        }
      });
    "#,
    &ReporterEvent::BuildStart,
    None,
    1,
    output_fs.clone(),
  )
  .expect("buildStart");

  let kind = |name: &str| output_fs.kind(PathId::new(&dir.join(name)));
  for name in ["a", "callback-r", "mode", "promise", "promise-r"] {
    assert!(kind(name).is_empty(), "{name} should have been removed");
  }
  assert!(kind("callback").contains(parcel_core::FileKind::IS_DIR));
}
