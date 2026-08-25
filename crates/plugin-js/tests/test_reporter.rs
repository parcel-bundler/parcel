use std::{borrow::Cow, collections::HashMap, path::Path, sync::Arc, time::Duration};

use parcel_core::{
  Asset, AssetFlags, AssetGraph, AssetIndex, AssetNode, AssetType, BufferContent, BuildSuccess,
  Bundle, BundleBehavior, BundleFlags, BundleGraph, Diagnostic, DiagnosticList, FileSystem,
  LogEvent, LogLevel, LogMessage, OverlayFileSystem, ParcelOptions, PathId, Reporter,
  ReporterEvent, SourceLocation, SourceUrl, Target,
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
  let fs = Arc::new(OverlayFileSystem::new());
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  let plugin_path = root.join(Path::new(name));
  fs.create_dir_all(root).expect("Error creating dir");
  fs.write(plugin_path, &code.as_bytes().to_owned())
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
      const CONFIG = Symbol.for('parcel-plugin-config');
      class Reporter { constructor(opts) { this[CONFIG] = opts; } }
      module.exports = {Reporter};
    "#
    .to_vec(),
  )
  .expect("Error writing plugin API");

  let plugin = JsPlugin::new(plugin_path, config);
  let options = ParcelOptions {
    input_fs: fs,
    ..Default::default()
  };
  (0..times)
    .map(|_| plugin.report(event, &options))
    .collect::<Result<Vec<()>, DiagnosticList>>()
    .map(|_| ())
}

fn bundle_graph() -> BundleGraph<'static> {
  let target = Arc::new(Target {
    dist_dir: PathId::new(Path::new("/dist")),
    public_url: "/assets".into(),
    ..Default::default()
  });
  let assets = vec![
    test_asset("file:///src/index.js", AssetType::Js, target.clone()),
    test_asset("file:///src/style.css", AssetType::Css, target.clone()),
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
  }];

  BundleGraph::new(
    AssetGraph {
      asset_nodes: Cow::Owned(
        (0..assets.len())
          .map(|index| AssetNode::Asset(AssetIndex::from_index(index)))
          .collect(),
      ),
      assets: Cow::Owned(assets),
      entries: Cow::Owned(vec![]),
    },
    bundles,
    HashMap::new(),
    PathId::new(Path::new("/")),
  )
}

fn test_asset(url: &str, ty: AssetType, target: Arc<Target>) -> Asset {
  Asset {
    loc: SourceLocation {
      url: SourceUrl::parse(url).unwrap(),
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
        buildStart({config}) {
          // Destructuring throws unless it was called with an object, so this
          // fails the test if buildStart is handed nothing.
          assert.equal(config, undefined);
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
        buildSuccess({bundleGraph, buildTime, changedAssets}) {
          assert.equal(typeof buildTime, 'number');
          assert.equal(buildTime, 1500);

          let bundles = bundleGraph.getBundles();
          assert.equal(bundles.length, 1);
          assert.equal(bundles[0].type, 'js');
          assert.equal(bundles[0].getMainEntry().url, 'file:///src/index.js');

          assert.equal(changedAssets.length, 1);
          assert.equal(changedAssets[0].url, 'file:///src/style.css');
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
