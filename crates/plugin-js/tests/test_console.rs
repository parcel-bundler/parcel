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
      if let LogMessage::Text(message) = log.message {
        self.0.lock().unwrap().push((log.level, message.to_owned()));
      }
    }
    Ok(())
  }
}

fn asset() -> Asset {
  Asset {
    loc: SourceLocation {
      url: SourceUrl::parse("file:///src/test.js").unwrap(),
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
  fs.write(path, source.as_bytes()).unwrap();
  let events = Arc::new(Mutex::new(Vec::new()));
  let mut plugins: Vec<Arc<dyn Reporter>> = vec![Arc::new(Recorder(events.clone()))];
  if let Some(source) = js_reporter {
    let path = root.child(&format!("{name}-reporter.cjs"));
    fs.write(path, source.as_bytes()).unwrap();
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
    module.exports = {[Symbol.for('parcel-plugin-config')]: {
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
      (LogLevel::Info, "{ value: 42 }, 7".into()),
    ]
  );
}

#[test]
fn console_obeys_rust_log_levels_and_supports_esm_imports() {
  let (plugin, options, events) = setup(
    "console-filter.mjs",
    r#"
    import console, {log, warn, error, debug} from 'console';
    export default {[Symbol.for('parcel-plugin-config')]: {
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
    module.exports = {[Symbol.for('parcel-plugin-config')]: {
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
    module.exports = {[Symbol.for('parcel-plugin-config')]: {
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
    module.exports = {[Symbol.for('parcel-plugin-config')]: {
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
