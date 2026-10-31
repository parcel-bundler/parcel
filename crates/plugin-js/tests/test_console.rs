#[path = "../../core/tests/support/mod.rs"]
mod test_utils;

use std::{
  path::Path,
  sync::{Arc, Mutex},
};

use parcel_core::{
  Asset, AssetFlags, AssetType, BufferContent, BundleBehavior, DiagnosticList, FileSystem,
  LogLevel, LogMessage, OverlayFileSystem, ParcelOptions, PathId, Reporter, ReporterEvent,
  Reporters, SourceLocation, SourceUrl, Transformer,
};
use parcel_plugin_js::JsPlugin;

struct Recorder(Arc<Mutex<Vec<(LogLevel, String)>>>);

impl Reporter for Recorder {
  fn report(&self, event: &ReporterEvent, _options: &ParcelOptions) -> Result<(), DiagnosticList> {
    if let ReporterEvent::Log(log) = event {
      match log.message {
        LogMessage::Text(message) => {
          self.0.lock().unwrap().push((log.level, message.to_owned()));
        }
        LogMessage::Diagnostics(diagnostics) => {
          for diagnostic in diagnostics {
            self.0.lock().unwrap().push((
              log.level,
              format!(
                "{} {:?}: {} {:?}",
                diagnostic.origin.as_deref().unwrap_or("unknown"),
                diagnostic.severity,
                diagnostic.message,
                diagnostic.hints
              ),
            ));
          }
        }
      }
    }
    Ok(())
  }
}

fn asset() -> Asset {
  Asset {
    loc: SourceLocation {
      url: SourceUrl::parse(test_utils::url("file:///src/test.js").as_str()).unwrap(),
      ..Default::default()
    },
    ty: AssetType::Js,
    content: Arc::new(BufferContent::new_string("hello".into())),
    target: Arc::new(Default::default()),
    pipeline: None,
    bundle_behavior: BundleBehavior::None,
    flags: AssetFlags::empty(),
    unique_key: None,
    dependencies: vec![],
    symbols: Default::default(),
  }
}

fn setup(
  name: &str,
  source: &str,
  level: LogLevel,
  js_reporter: Option<&str>,
) -> (
  JsPlugin,
  Arc<ParcelOptions>,
  Arc<Mutex<Vec<(LogLevel, String)>>>,
) {
  let fs = Arc::new(OverlayFileSystem::new());
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  fs.create_dir_all(root).unwrap();
  let path = root.child(name);
  fs.write(path, test_utils::js(source).as_bytes()).unwrap();
  let events = Arc::new(Mutex::new(Vec::new()));
  let mut plugins: Vec<Arc<dyn Reporter>> = vec![Arc::new(Recorder(events.clone()))];
  if let Some(source) = js_reporter {
    let path = root.child(&format!("{name}-reporter.cjs"));
    fs.write(path, test_utils::js(source).as_bytes()).unwrap();
    plugins.push(Arc::new(JsPlugin::new(path, "test-plugin", None)));
  }
  let reporters = Reporters::new(plugins, level);
  let options = Arc::new(ParcelOptions {
    input_fs: fs,
    log_level: level,
    reporters: reporters.clone(),
    ..Default::default()
  });
  reporters.attach(Arc::downgrade(&options));
  (JsPlugin::new(path, "test-plugin", None), options, events)
}

#[test]
fn console_logs_reach_rust_reporters_even_when_the_plugin_fails() {
  let (plugin, options, events) = setup(
    "console-failure.cjs",
    r#"
    console.log('module loaded');
    const {info, warn, error, debug} = require('console');
    module.exports = {[Symbol.for('parcel.plugin.v3.transformer')]: {
      async transform() {
        console.log('message');
        await Promise.resolve();
        info('info'); warn('warning'); error('failure'); debug('verbose');
        console.log({value: 42}, 7);
        throw new Error('plugin failed');
      }
    }};
  "#,
    LogLevel::Info,
    None,
  );
  let error = plugin
    .transform(
      asset(),
      &parcel_core::PluginContext::new(&options, &options.input_fs),
    )
    .unwrap_err();
  assert!(error.0[0].message.contains("plugin failed"));
  assert_eq!(
    *events.lock().unwrap(),
    vec![
      (LogLevel::Info, "module loaded".into()),
      (LogLevel::Info, "message".into()),
      (LogLevel::Info, "info".into()),
      (LogLevel::Warn, "warning".into()),
      (LogLevel::Error, "failure".into()),
      (LogLevel::Info, "{ value: 42 } 7".into()),
    ]
  );
}

#[test]
fn console_obeys_rust_log_levels_and_supports_esm_imports() {
  let (plugin, options, events) = setup(
    "console-filter.mjs",
    r#"
    import console, {log, warn, error, debug} from 'console';
    export default {[Symbol.for('parcel.plugin.v3.transformer')]: {
      transform() {
        log('hidden'); console.info('hidden'); debug('hidden');
        warn('warning'); error('failure');
      }
    }};
  "#,
    LogLevel::Warn,
    None,
  );
  plugin
    .transform(
      asset(),
      &parcel_core::PluginContext::new(&options, &options.input_fs),
    )
    .unwrap();
  assert_eq!(
    *events.lock().unwrap(),
    vec![
      (LogLevel::Warn, "warning".into()),
      (LogLevel::Error, "failure".into()),
    ]
  );
}

#[test]
fn console_can_deliver_to_javascript_reporters_without_reentry_or_recursion() {
  let (plugin, options, events) = setup(
    "console-js-reporter.cjs",
    r#"
    const assert = require('assert');
    module.exports = {[Symbol.for('parcel.plugin.v3.transformer')]: {
      transform() {
        if (globalThis.outerLogged) {
          assert.equal(globalThis.reported, true);
          assert.equal(globalThis.reportedCalls, 1);
        } else {
          globalThis.outerLogged = true;
          console.log('outer');
        }
      }
    }};
  "#,
    LogLevel::Info,
    Some(
      r#"
    const assert = require('assert');
    module.exports = {[Symbol.for('parcel.plugin.v3.reporter')]: {
      log({message}) {
        assert.equal(message, 'outer');
        globalThis.reportedCalls = (globalThis.reportedCalls || 0) + 1;
        console.log('reporter output');
        globalThis.reported = true;
      }
    }};
  "#,
    ),
  );
  plugin
    .transform(
      asset(),
      &parcel_core::PluginContext::new(&options, &options.input_fs),
    )
    .unwrap();
  plugin
    .transform(
      asset(),
      &parcel_core::PluginContext::new(&options, &options.input_fs),
    )
    .unwrap();
  assert_eq!(
    *events.lock().unwrap(),
    vec![(LogLevel::Info, "outer".into())]
  );
}

#[test]
fn console_debug_uses_verbose_level() {
  let (plugin, options, events) = setup(
    "console-verbose.cjs",
    r#"
    module.exports = {[Symbol.for('parcel.plugin.v3.transformer')]: {
      transform() { console.debug('details'); }
    }};
  "#,
    LogLevel::Verbose,
    None,
  );
  plugin
    .transform(
      asset(),
      &parcel_core::PluginContext::new(&options, &options.input_fs),
    )
    .unwrap();
  assert_eq!(
    *events.lock().unwrap(),
    vec![(LogLevel::Verbose, "details".into())]
  );
}

#[test]
fn console_logs_diagnostics() {
  let (plugin, options, events) = setup(
    "console-diagnostics.mjs",
    r#"
    import {Transformer, Diagnostic} from '@parcel/plugin';
    export default new Transformer({
      transform() {
        console.warn(new Diagnostic({message: 'careful', hints: ['a hint']}));
        console.error(new Diagnostic([
          {message: 'one', origin: 'other'},
          {message: 'two', severity: 'info'},
        ]));
        console.info(new Diagnostic({message: 'note'}), new Diagnostic({message: 'another'}));
      }
    });
  "#,
    LogLevel::Info,
    None,
  );
  plugin
    .transform(
      asset(),
      &parcel_core::PluginContext::new(&options, &options.input_fs),
    )
    .unwrap();
  assert_eq!(
    *events.lock().unwrap(),
    vec![
      (
        LogLevel::Warn,
        r#"test-plugin Warning: careful ["a hint"]"#.into()
      ),
      (LogLevel::Error, "other Error: one []".into()),
      (LogLevel::Error, "test-plugin Info: two []".into()),
      (LogLevel::Info, "test-plugin Info: note []".into()),
      (LogLevel::Info, "test-plugin Info: another []".into()),
    ]
  );
}

#[test]
fn console_logs_from_javascript_called_back_by_a_plugin_are_delivered_in_order() {
  let (plugin, options, events) = setup(
    "console-reentrant.mjs",
    r#"
    export default {[Symbol.for('parcel.plugin.v3.transformer')]: {
      async transform({asset, resolve}) {
        console.log('before');
        // A URL, so that the empty transformer config is allowed.
        await resolve(asset.filePath, './dep', {importType: 'url'});
        console.log('after');
      }
    }};
  "#,
    LogLevel::Info,
    None,
  );
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  let resolver_path = root.child("console-reentrant-resolver.mjs");
  options
    .input_fs
    .write(
      resolver_path,
      test_utils::js(
        r#"
    import {Resolver, Diagnostic} from '@parcel/plugin';
    export default new Resolver({
      resolve() {
        console.log('resolving');
        console.warn(new Diagnostic({message: 'from resolver'}));
        return {filePath: testPath('/src/dep.js')};
      }
    });
  "#,
      )
      .as_bytes(),
    )
    .unwrap();
  let resolvers: Vec<Arc<dyn parcel_core::Resolver>> = vec![Arc::new(JsPlugin::new(
    resolver_path,
    "test-resolver",
    None,
  ))];
  let transformers = Default::default();
  plugin
    .transform(
      asset(),
      &parcel_core::PluginContext::new(&options, &options.input_fs)
        .with_resolvers(&resolvers, &transformers),
    )
    .unwrap();
  assert_eq!(
    *events.lock().unwrap(),
    vec![
      (LogLevel::Info, "before".into()),
      (LogLevel::Info, "resolving".into()),
      (
        LogLevel::Warn,
        "test-resolver Warning: from resolver []".into()
      ),
      (LogLevel::Info, "after".into()),
    ]
  );
}

#[test]
fn console_formats_values_like_node() {
  let (plugin, options, events) = setup(
    "console-format.cjs",
    r#"
    const util = require('util');
    class Foo { constructor() { this.x = 1; } }
    const circular = {a: 1}; circular.self = circular;
    module.exports = {[Symbol.for('parcel.plugin.v3.transformer')]: {
      transform() {
        console.log('plain', 'strings', 42);
        console.log('%s=%d %i %f %j %o %O %c%%', 'a', 42.5, 42.5, '1.5', {j: 1}, [1], {O: 'x'}, 'color: red', 'extra');
        console.log({a: 'str', b: [1, 'two', {c: null}], d: undefined, e: 10n, f: Symbol('s'), g() {}, h: class K {}});
        console.log(new Map([['k', {v: 1}]]), new Set([1, 'a']));
        console.log(new Uint8Array([1, 2, 3]), new Float64Array(2), Buffer.from('ab'), new ArrayBuffer(2));
        console.log(circular, new Foo(), Object.create(null), [, 1], new Date(0), /re/g, -0, null);
        console.log({a: {b: {c: {d: 1}}}});
        console.log(Array.from({length: 30}, (_, i) => i));
        console.log(util.inspect('quoted'), util.format('%s', 'x', 'y'));
        const error = new TypeError('boom');
        error.code = 'E_BOOM';
        console.error({error});
      }
    }};
  "#,
    LogLevel::Info,
    None,
  );
  plugin
    .transform(
      asset(),
      &parcel_core::PluginContext::new(&options, &options.input_fs),
    )
    .unwrap();
  let mut events = events.lock().unwrap().clone();
  let (level, error) = events.pop().unwrap();
  assert_eq!(level, LogLevel::Error);
  // The stack follows the error's name and message, as in V8, then its own properties.
  assert!(
    error.starts_with("{\n  error: TypeError: boom\n      at transform (")
      && error.contains("console-format.cjs:")
      && error.ends_with(" {\n    code: 'E_BOOM'\n  }\n}"),
    "{error}"
  );
  let expected = [
    "plain strings 42",
    r#"a=42.5 42 1.5 {"j":1} [ 1, [length]: 1 ] { O: 'x' } % extra"#,
    "{\n  a: 'str',\n  b: [ 1, 'two', { c: null } ],\n  d: undefined,\n  e: 10n,\n  f: Symbol(s),\n  g: [Function: g],\n  h: [class K]\n}",
    "Map(1) { 'k' => { v: 1 } } Set(2) { 1, 'a' }",
    "Uint8Array(3) [ 1, 2, 3 ] Float64Array(2) [ 0, 0 ] <Buffer 61 62> ArrayBuffer { [Uint8Contents]: <00 00>, [byteLength]: 2 }",
    "<ref *1> { a: 1, self: [Circular *1] } Foo { x: 1 } [Object: null prototype] {} [ <1 empty item>, 1 ] 1970-01-01T00:00:00.000Z /re/g -0 null",
    "{ a: { b: { c: [Object] } } }",
    "[\n   0,  1,  2,  3,  4,  5,  6,  7,  8,\n   9, 10, 11, 12, 13, 14, 15, 16, 17,\n  18, 19, 20, 21, 22, 23, 24, 25, 26,\n  27, 28, 29\n]",
    "'quoted' x y",
  ];
  assert_eq!(
    events,
    expected
      .iter()
      .map(|message| (LogLevel::Info, message.to_string()))
      .collect::<Vec<_>>()
  );
}
