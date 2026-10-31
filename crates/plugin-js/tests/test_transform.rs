#[path = "../../core/tests/support/mod.rs"]
mod test_utils;

use std::{path::Path, sync::Arc};

use parcel_core::{
  Asset, AssetFlags, AssetRequest, AssetType, BufferContent, BundleBehavior, DependencyResolution,
  DiagnosticList, FileSystem, OverlayFileSystem, ParcelOptions, PathId, SourceLocation, SourceUrl,
  SpecifierType, Transformer,
};
use parcel_plugin_js::JsPlugin;

fn run(name: &str, code: &str, asset: Asset) -> Result<Asset, DiagnosticList> {
  run_with_config(name, code, asset, None)
}

fn run_with_config(
  name: &str,
  code: &str,
  asset: Asset,
  config: Option<serde_json::Value>,
) -> Result<Asset, DiagnosticList> {
  run_with_options(name, code, asset, config, ParcelOptions::default())
}

fn run_with_options(
  name: &str,
  code: &str,
  asset: Asset,
  config: Option<serde_json::Value>,
  mut options: ParcelOptions,
) -> Result<Asset, DiagnosticList> {
  let fs = Arc::new(OverlayFileSystem::new());
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  let plugin_path = root.join(Path::new(name));
  fs.create_dir_all(root).expect("Error creating dir");
  fs.write(plugin_path, &test_utils::js(code).as_bytes().to_owned())
    .expect("Error writing file");
  let plugin = JsPlugin::new(plugin_path, "test-plugin", config);
  let dyn_fs: Arc<dyn FileSystem> = fs.clone();
  options.input_fs = fs;
  plugin.transform(asset, &parcel_core::PluginContext::new(&options, &dyn_fs))
}

fn run_with_fs(
  fs: Arc<OverlayFileSystem>,
  name: &str,
  code: &str,
) -> Result<Asset, DiagnosticList> {
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  let plugin_path = root.join(Path::new(name));
  fs.write(plugin_path, test_utils::js(code).as_bytes())
    .unwrap();
  let plugin = JsPlugin::new(plugin_path, "test-plugin", None);
  let dyn_fs: Arc<dyn FileSystem> = fs.clone();
  let options = ParcelOptions {
    input_fs: fs,
    ..Default::default()
  };
  plugin.transform(
    test_asset(),
    &parcel_core::PluginContext::new(&options, &dyn_fs),
  )
}

#[test]
fn test_transform_config() {
  let result = run_with_config(
    "plugin-config.mjs",
    r#"
      import {Transformer} from '@parcel/plugin';
      import assert from 'assert';

      export default new Transformer({
        transform({asset, config}) {
          assert.deepEqual(config, {message: 'configured', nested: [true, null, 42]});
          asset.setCode(config.message);
        }
      });
    "#,
    test_asset(),
    Some(serde_json::json!({
      "message": "configured",
      "nested": [true, null, 42]
    })),
  )
  .unwrap();

  assert_eq!(result.content.read().unwrap(), b"configured");
}

fn test_asset() -> Asset {
  Asset {
    loc: SourceLocation {
      url: SourceUrl::parse(test_utils::url("file:///foo/bar.js").as_str()).unwrap(),
      start: Default::default(),
      end: Default::default(),
    },
    ty: AssetType::Js,
    bundle_behavior: parcel_core::BundleBehavior::None,
    content: Arc::new(BufferContent::new("hello".as_bytes().to_owned())),
    dependencies: Vec::new(),
    flags: AssetFlags::SIDE_EFFECTS,
    pipeline: None,
    symbols: Default::default(),
    target: Arc::new(Default::default()),
    unique_key: None,
  }
}

#[test]
fn test_asset_dependency_api() {
  let result = run("dependencies.cjs", r#"
    const assert = require('assert');
    module.exports = {[Symbol.for('parcel.plugin.v3.transformer')]: {
      transform({asset}) {
        assert.equal(asset.getDependencies().length, 0);
        assert.equal(asset.uniqueKey, null);
        assert.equal(asset.pipeline, null);
        asset.uniqueKey = 'generated';
        assert.throws(() => {asset.uniqueKey = 'other';}, /uniqueKey/);
        asset.pipeline = 'custom';
        asset.sideEffects = false;
        const placeholder = asset.addDependency({
          specifier: './dep.js', specifierType: 'commonjs', priority: 'parallel',
          bundleBehavior: 'isolated', isOptional: true, needsStableName: true,
          packageConditions: ['browser', 'require', 'my-condition'], range: '^1.0.0',
          resolveFrom: testPath('/src/custom.js'),
          loc: {filePath: testPath('/src/custom.js'), start: {line: 2, column: 1}, end: {line: 2, column: 8}}
        });
        const dep = asset.getDependencies()[0];
        assert.equal(dep.specifier, './dep.js');
        assert.equal(dep.specifierType, 'commonjs');
        assert.equal(dep.priority, 'parallel');
        assert.equal(dep.bundleBehavior, 'isolated');
        assert.equal(dep.importType, 'javascript');
        assert.equal(dep.isOptional, true);
        assert.equal(dep.needsStableName, true);
        assert.equal(dep.placeholder, placeholder);
        assert.equal(dep.resolveFrom, testPath('/src/custom.js'));
        assert.equal(dep.range, '^1.0.0');
        // Custom conditions are kept, after the ones Parcel knows.
        assert.deepEqual(dep.packageConditions, ['require', 'browser', 'my-condition']);
        assert.deepEqual(dep.loc, {filePath: testPath('/src/custom.js'), start: {line: 2, column: 1}, end: {line: 2, column: 8}});
        const opts = Object.freeze({priority: 'parallel', bundleBehavior: 'inline'});
        const url = asset.addURLDependency('./image.png', opts);
        const defaultUrl = asset.addURLDependency('./lazy.png');
        const deps = asset.getDependencies();
        assert.equal(deps.length, 3);
        assert.equal(deps[1].specifierType, 'url');
        assert.equal(deps[1].priority, 'parallel');
        assert.equal(deps[1].bundleBehavior, 'inline');
        assert.equal(deps[1].importType, 'url');
        assert.equal(deps[1].placeholder, url);
        assert.equal(deps[2].priority, 'lazy');
        assert.equal(deps[2].placeholder, defaultUrl);
        assert.equal(deps[2].resolveFrom, asset.filePath);
        // Retaining a dependency is safe across reallocations of the asset's vector.
        for (let i = 0; i < 64; i++) asset.addDependency({specifier: './dep' + i});
        assert.equal(dep.specifier, './dep.js');
        assert.equal(dep.target.environment, asset.target.environment);
        assert.equal(asset.uniqueKey, 'generated');
        assert.equal(asset.pipeline, 'custom');
        assert.equal(asset.sideEffects, false);
      }
    }};
  "#, test_asset()).unwrap();
  assert_eq!(result.unique_key.as_deref(), Some("generated"));
  assert_eq!(result.pipeline.as_deref(), Some("custom"));
  assert!(!result.flags.contains(AssetFlags::SIDE_EFFECTS));
  assert_eq!(result.dependencies.len(), 67);
  assert_eq!(
    result.dependencies[0].resolve_from,
    Some(SourceUrl::parse(test_utils::url("file:///src/custom.js").as_str()).unwrap())
  );
  assert_eq!(
    result.dependencies[1].import_type,
    parcel_core::ImportType::Url
  );
}

#[test]
fn test_asset_dependency_validation() {
  run(
    "invalid-dependency.cjs",
    r#"
    const assert = require('assert');
    module.exports = {[Symbol.for('parcel.plugin.v3.transformer')]: {
      transform({asset}) {
        for (const [key, value] of [
          ['specifierType', 'bad'], ['priority', 'bad'], ['bundleBehavior', 'bad'],
          ['importType', 'bad']
        ]) {
          assert.throws(() => asset.addDependency({specifier: './dep', [key]: value}));
        }
        assert.throws(() => { asset.bundleBehavior = 'bad'; }, TypeError);
        asset.bundleBehavior = 'inline';
        asset.bundleBehavior = 'none';
        assert.equal(asset.bundleBehavior, undefined);
        assert.equal(asset.getDependencies().length, 0);
        asset.pipeline = 'custom';
        asset.pipeline = null;
        asset.sideEffects = false;
        asset.sideEffects = true;
        assert.equal(asset.pipeline, null);
        assert.equal(asset.sideEffects, true);
      }
    }};
  "#,
    test_asset(),
  )
  .unwrap();
}

#[test]
fn test_asset_json_source_maps() {
  use parcel_core::ContentWithSourceMap;
  let mut asset = test_asset();
  asset.content = Arc::new(ContentWithSourceMap::new_string(
    "hello".into(),
    br#"{"version":3,"sources":["old.js"],"mappings":"AAAA"}"#.to_vec(),
  ));
  let result = run("maps.cjs", r#"
    const assert = require('assert');
    module.exports = {[Symbol.for('parcel.plugin.v3.transformer')]: {
      transform({asset}) {
        assert.equal(asset.getMap().sources[0], 'old.js');
        const map = {version: 3, sources: ['new.js'], names: [], mappings: 'AAAA', sourcesContent: ['hello']};
        asset.setCode('mapped', map);
        assert.equal(asset.getCode(), 'mapped');
        assert.deepEqual(asset.getMap(), map);
        asset.getMap().sources.push('mutation');
        assert.deepEqual(asset.getMap(), map);
        const cyclic = {}; cyclic.self = cyclic;
        assert.throws(() => asset.setCode('bad', cyclic));
        assert.throws(() => asset.setCode('bad', 'not an object'));
        assert.equal(asset.getCode(), 'mapped');
        assert.deepEqual(asset.getMap(), map);
        asset.setBuffer(new Uint8Array([0, 255]), map);
        assert.deepEqual([...asset.getBuffer()], [0, 255]);
        assert.deepEqual(asset.getMap(), map);
        asset.setCode('unmapped');
        assert.equal(asset.getMap(), null);
        asset.setCode('mapped', map);
        asset.setCode('unmapped', null);
        assert.equal(asset.getMap(), null);
        asset.setCode('mapped', map);
        asset.setBuffer(new Uint8Array([1]), undefined);
        assert.equal(asset.getMap(), null);
        asset.setBuffer(new Uint8Array([104, 105]), map);
      }
    }};
  "#, asset).unwrap();
  assert_eq!(result.content.read().unwrap(), b"hi");
  let map: serde_json::Value = serde_json::from_slice(
    result
      .content
      .downcast_ref::<ContentWithSourceMap>()
      .unwrap()
      .source_map(),
  )
  .unwrap();
  assert_eq!(map["sources"], serde_json::json!(["new.js"]));
}

#[test]
fn test_plugin_options_and_target() {
  use parcel_core::{
    BuildMode, HmrOptions, IncludeNodeModules, LogLevel, Target, TargetSourceMapOptions,
  };
  let mut asset = test_asset();
  asset.target = Arc::new(Target {
    engines: serde_json::from_value(
      serde_json::json!({"node": ">=18.2", "browsers": ["chrome 100"]}),
    )
    .unwrap(),
    include_node_modules: IncludeNodeModules::Array(vec!["example".into()]),
    source_map: Some(TargetSourceMapOptions {
      source_root: Some("/src".into()),
      inline: Some(true),
      inline_sources: Some(false),
    }),
    ..Default::default()
  });
  let options = ParcelOptions {
    mode: BuildMode::Production,
    env: std::collections::HashMap::from([("CUSTOM".into(), "value".into())]),
    log_level: LogLevel::Warn,
    hmr: Some(HmrOptions {
      host: "localhost".into(),
      port: 1234,
    }),
    ..Default::default()
  };
  run_with_options("options-target.cjs", r#"
    const assert = require('assert');
    module.exports = {[Symbol.for('parcel.plugin.v3.transformer')]: {
      transform({asset, options, logger, tracer}) {
        assert.equal(options.mode, 'production');
        assert.deepEqual(options.env, {CUSTOM: 'value'});
        options.env.CUSTOM = 'changed';
        assert.equal(options.env.CUSTOM, 'value');
        assert.equal(options.logLevel, 'warn');
        assert.deepEqual(options.hmrOptions, {host: 'localhost', port: 1234});
        assert.deepEqual(asset.target.includeNodeModules, ['example']);
        assert.equal(asset.target.engines.node, '>= 18.2');
        assert.equal(asset.target.engines.browsers, 'chrome >= 100');
        assert.deepEqual(asset.target.sourceMap, {sourceRoot: '/src', inline: true, inlineSources: false});
        for (const key of ['inputFS', 'outputFS', 'packageManager', 'parcelVersion', 'instanceId',
          'shouldBuildLazily', 'shouldAutoInstall', 'cacheDir', 'detailedReport', 'featureFlags']) {
          assert.equal(options[key], undefined);
        }
        assert.equal(asset.target.shouldScopeHoist, undefined);
        assert.equal(logger, undefined);
        assert.equal(tracer, undefined);
      }
    }};
  "#, asset, None, options).unwrap();
}

#[test]
fn test_plugin_options_defaults_and_target_variants() {
  use parcel_core::{BuildMode, IncludeNodeModules, Target};
  for (i, modules) in [
    IncludeNodeModules::Bool(false),
    IncludeNodeModules::Map(std::collections::BTreeMap::from([("example".into(), true)])),
  ]
  .into_iter()
  .enumerate()
  {
    let mut asset = test_asset();
    asset.target = Arc::new(Target {
      include_node_modules: modules,
      ..Default::default()
    });
    run_with_options(&format!("options-default-{i}.cjs"), r#"
      const assert = require('assert');
      module.exports = {[Symbol.for('parcel.plugin.v3.transformer')]: {
        transform({asset, options}) {
          assert.equal(options.mode, 'custom');
          assert.equal(options.logLevel, 'info');
          assert.deepEqual(options.env, {});
          assert.equal(options.hmrOptions, null);
          assert.equal(asset.target.sourceMap, null);
          assert.equal(asset.target.isServer(), false);
          assert.equal(asset.target.isWorklet(), false);
          assert(asset.target.includeNodeModules === false || asset.target.includeNodeModules.example === true);
        }
      }};
    "#, asset, None, ParcelOptions {mode: BuildMode::Other("custom".into()), ..Default::default()}).unwrap();
  }
}

#[test]
fn plugin_fs_reads_are_tracked_by_the_plugin_tracker() {
  use parcel_core::TrackingFileSystem;
  let fs = Arc::new(OverlayFileSystem::new());
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  fs.create_dir_all(root).unwrap();
  let path = root.child("tracked-config.cjs");
  let config_path = root.child("tracked-config.json");
  let source = format!(
    r#"
    const fs = require('fs');
    module.exports = {{[Symbol.for('parcel.plugin.v3.transformer')]: {{
      transform({{asset}}) {{
        asset.setCode(JSON.parse(fs.readFileSync({}, 'utf8')).value);
      }}
    }}}};
  "#,
    serde_json::to_string(&config_path.to_path_buf().to_string_lossy()).unwrap()
  );
  fs.write(path, test_utils::js(&source).as_bytes()).unwrap();
  let plugin = JsPlugin::new(path, "test-plugin", None);
  // The plugin may cache what it reads, so reads go to the build-wide plugin tracker rather than
  // the asset's.
  let plugin_tracker = Arc::new(TrackingFileSystem::new(fs.clone()));
  let options = ParcelOptions {
    input_fs: fs.clone(),
    plugin_tracker: Some(plugin_tracker.clone()),
    ..Default::default()
  };
  for value in ["first", "second"] {
    fs.write(
      config_path,
      serde_json::json!({"value": value}).to_string().as_bytes(),
    )
    .unwrap();
    let asset_tracker = Arc::new(TrackingFileSystem::new(fs.clone()));
    let asset_fs: Arc<dyn FileSystem> = asset_tracker.clone();
    let result = plugin
      .transform(
        test_asset(),
        &parcel_core::PluginContext::new(&options, &asset_fs),
      )
      .unwrap();
    assert_eq!(result.content.read().unwrap(), value.as_bytes());
    assert!(
      plugin_tracker
        .take()
        .invalidate_on_file_change
        .contains(&config_path)
    );
    assert!(asset_tracker.take().invalidate_on_file_change.is_empty());
  }
}

#[test]
fn test_transform_esm() {
  let input = test_asset();
  let result = run(
    "plugin.mjs",
    r#"
  import {Transformer} from '@parcel/plugin';
  import assert from 'assert';

  export default new Transformer({
    transform({asset}) {
      let code = asset.getCode();
      assert.equal(code, 'hello');
      assert.equal(asset.type, 'js');
      assert.equal(asset.url, testUrl('file:///foo/bar.js'));
      assert.equal(asset.bundleBehavior, null);
      assert.equal(asset.sideEffects, true);
      assert.equal(asset.isSource, false);
      assert.equal(asset.target.environment, 'browser');
      assert.equal(asset.target.outputFormat, 'global');
      assert.equal(asset.target.sourceType, 'module');
      assert.equal(asset.target.isLibrary, false);
      assert.equal(asset.target.shouldOptimize, false);
      assert.equal(asset.target.isBrowser(), true);
      assert.equal(asset.target.isNode(), false);
      assert.equal(asset.target.isWorker(), false);
      assert.equal(asset.target.isElectron(), false);

      asset.setCode('testing');
      asset.type = 'css';
      asset.bundleBehavior = 'isolated';
    }
  });
  "#,
    input,
  )
  .unwrap();

  assert_eq!(
    result.content.read().unwrap(),
    "testing".as_bytes().to_owned()
  );
  assert_eq!(result.ty, AssetType::Css);
  assert_eq!(result.bundle_behavior, BundleBehavior::Isolated);
}

#[test]
fn test_transform_esm_imports_cjs_reserved_word_exports() {
  let fs = Arc::new(OverlayFileSystem::new());
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  fs.create_dir_all(root).unwrap();
  fs.write(
    root.child("reserved-exports.cjs"),
    br#"
      exports.eval = 'eval';
      exports.null = 'null';
      exports.mod = 'mod';
      exports['not-an-identifier'] = 'other';
    "#,
  )
  .unwrap();

  let result = run_with_fs(
    fs,
    "reserved-exports-plugin.mjs",
    r#"
      import {Transformer} from '@parcel/plugin';
      import cjs, {eval as e, null as n, mod} from './reserved-exports.cjs';

      export default new Transformer({
        transform({asset}) {
          asset.setCode([e, n, mod, cjs['not-an-identifier']].join(','));
        }
      });
    "#,
  )
  .unwrap();

  assert_eq!(result.content.read().unwrap(), b"eval,null,mod,other");
}

#[test]
fn test_transform_get_code_binary_content() {
  // Binary (non-UTF-8) asset content should be returned as a lossy string
  // (replacement characters for invalid sequences) rather than panicking.
  let mut input = test_asset();
  input.content = Arc::new(BufferContent::new(vec![0x68, 0x69, 0xff, 0xfe, 0x21]));
  let result = run(
    "plugin-binary.mjs",
    r#"
  import {Transformer} from '@parcel/plugin';
  import assert from 'assert';

  export default new Transformer({
    transform({asset}) {
      let code = asset.getCode();
      assert.equal(code, 'hi��!');
      asset.setCode('ok');
    }
  });
  "#,
    input,
  )
  .unwrap();

  assert_eq!(result.content.read().unwrap(), b"ok");
}

#[test]
fn test_transform_cjs() {
  let input = test_asset();
  let result = run(
    "plugin.cjs",
    r#"
  const {Transformer} = require('@parcel/plugin');
  const assert = require('assert');

  module.exports = new Transformer({
    transform({asset}) {
      let code = asset.getCode();
      assert.equal(code, 'hello');
      assert.equal(asset.type, 'js');
      assert.equal(asset.url, testUrl('file:///foo/bar.js'));
      assert.equal(asset.bundleBehavior, null);
      assert.equal(asset.sideEffects, true);
      assert.equal(asset.isSource, false);
      assert.equal(asset.target.environment, 'browser');
      assert.equal(asset.target.outputFormat, 'global');
      assert.equal(asset.target.sourceType, 'module');
      assert.equal(asset.target.isLibrary, false);
      assert.equal(asset.target.shouldOptimize, false);
      assert.equal(asset.target.isBrowser(), true);
      assert.equal(asset.target.isNode(), false);
      assert.equal(asset.target.isWorker(), false);
      assert.equal(asset.target.isElectron(), false);

      asset.setCode('testing');
      asset.type = 'css';
      asset.bundleBehavior = 'isolated';
    }
  });
  "#,
    input,
  )
  .unwrap();

  assert_eq!(
    result.content.read().unwrap(),
    "testing".as_bytes().to_owned()
  );
  assert_eq!(result.ty, AssetType::Css);
  assert_eq!(result.bundle_behavior, BundleBehavior::Isolated);
}

#[test]
fn test_transform_async() {
  let input = test_asset();
  let result = run(
    "plugin.mjs",
    r#"
  import {Transformer} from '@parcel/plugin';
  import assert from 'assert';

  export default new Transformer({
    async transform({asset}) {
      let code = await asset.getCode();
      assert.equal(code, 'hello');
      asset.setCode('testing');
      asset.type = 'css';
    }
  });
  "#,
    input,
  )
  .unwrap();

  assert_eq!(
    result.content.read().unwrap(),
    "testing".as_bytes().to_owned()
  );
}

#[test]
fn test_transform_errors_are_attributed_to_the_plugin() {
  let diagnostics = run(
    "plugin-throws.mjs",
    r#"
  import {Transformer} from '@parcel/plugin';

  export default new Transformer({
    transform() {
      throw new Error('failed');
    }
  });
  "#,
    test_asset(),
  )
  .unwrap_err();

  assert_eq!(diagnostics.0.len(), 1);
  assert_eq!(diagnostics.0[0].message, "failed");
  assert_eq!(diagnostics.0[0].origin.as_deref(), Some("test-plugin"));
}

#[test]
fn test_transform_throws_diagnostics() {
  let diagnostics = run(
    "plugin-throws-diagnostics.mjs",
    r#"
  import {Transformer, Diagnostic} from '@parcel/plugin';

  export default new Transformer({
    async transform({asset}) {
      throw new Diagnostic([
        {
          message: 'first',
          codeFrames: [
            {
              filePath: testPath('/src/index.js'),
              code: 'let x = 1;',
              language: 'ts',
              codeHighlights: [
                {start: {line: 1, column: 5}, end: {line: 1, column: 5}, message: 'here'},
                {start: {line: 1, column: 9}},
              ],
            },
            {url: testUrl('file:///src/other.js'), codeHighlights: []},
            {filePath: 'relative.js', codeHighlights: []},
          ],
          hints: ['try this'],
          documentationURL: 'https://parceljs.org',
        },
        {message: 'second', origin: 'custom-origin', severity: 'warning'},
      ]);
    }
  });
  "#,
    test_asset(),
  )
  .unwrap_err();

  let location = |line, column| parcel_core::Location { line, column };
  assert_eq!(
    diagnostics.0,
    vec![
      parcel_core::Diagnostic {
        message: "first".into(),
        origin: Some("test-plugin".into()),
        code_frames: vec![
          parcel_core::CodeFrame {
            code: Some("let x = 1;".into()),
            url: Some(SourceUrl::parse(test_utils::url("file:///src/index.js").as_str()).unwrap()),
            language: Some(AssetType::Ts),
            code_highlights: vec![
              parcel_core::CodeHighlight {
                message: Some("here".into()),
                start: location(1, 5),
                end: location(1, 5),
              },
              parcel_core::CodeHighlight {
                message: None,
                start: location(1, 9),
                end: location(1, 9),
              },
            ],
          },
          parcel_core::CodeFrame {
            url: Some(SourceUrl::parse(test_utils::url("file:///src/other.js").as_str()).unwrap()),
            ..Default::default()
          },
          // Only absolute paths can be reported.
          parcel_core::CodeFrame::default(),
        ],
        hints: vec!["try this".into()],
        severity: parcel_core::DiagnosticSeverity::Error,
        documentation_url: Some("https://parceljs.org".into()),
      },
      parcel_core::Diagnostic {
        origin: Some("custom-origin".into()),
        severity: parcel_core::DiagnosticSeverity::Warning,
        ..parcel_core::Diagnostic::from_message("second".into())
      },
    ]
  );
}

/// A transformer config with a no-op transformer for files matching `glob`. Files resolved as
/// JavaScript must have a transformer.
fn transformers(glob: &str) -> parcel_core::PipelineMap<dyn Transformer> {
  struct Noop;
  impl Transformer for Noop {
    fn transform(
      &self,
      asset: Asset,
      _ctx: &parcel_core::PluginContext,
    ) -> Result<Asset, DiagnosticList> {
      Ok(asset)
    }
  }

  parcel_core::PipelineMap(vec![(
    glob.into(),
    vec![parcel_core::PipelineNode::Plugin(Arc::new(Noop))],
  )])
}

/// Resolves the way Parcel's default resolver does, from what the dependency carries, so tests
/// can see that `resolve` passes the specifier type and conditions through the resolver chain.
/// Custom specifiers, which only a plugin could resolve, go to `custom.js`.
struct NodeResolver;

impl parcel_core::Resolver for NodeResolver {
  fn resolve(
    &self,
    dep: &parcel_core::Dependency,
    specifier: &str,
    _pipeline: Option<&str>,
    ctx: &parcel_core::PluginContext,
  ) -> Result<DependencyResolution, DiagnosticList> {
    let from = dep.resolve_from.as_ref().unwrap().to_file_path()?;
    let path = if dep.specifier_type == SpecifierType::Custom {
      from.parent().unwrap().child("custom.js")
    } else {
      let resolver = parcel_resolver::Resolver::parcel(ctx.options.project_root);
      let specifier_type = match dep.specifier_type {
        SpecifierType::Commonjs => parcel_resolver::SpecifierType::Cjs,
        SpecifierType::Url => parcel_resolver::SpecifierType::Url,
        _ => parcel_resolver::SpecifierType::Esm,
      };
      let options = parcel_resolver::ResolveOptions {
        conditions: dep.conditions,
        custom_conditions: dep.custom_conditions.to_vec(),
      };
      match resolver.resolve_with_options(specifier, from, specifier_type, &**ctx.fs, options) {
        Ok(parcel_resolver::ResolutionAndQuery {
          resolution: parcel_resolver::Resolution::Path(path),
          ..
        }) => path,
        _ => return Ok(DependencyResolution::None),
      }
    };
    Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
      loc: SourceLocation {
        url: SourceUrl::from_path(&path),
        ..Default::default()
      },
      ty: AssetType::from_extension(path.extension().unwrap_or_default()),
      pipeline: None,
      target: dep.target.clone(),
      content: Arc::new(BufferContent::new_string(String::new())),
      side_effects: true,
      unique_key: None,
    })))
  }
}

#[test]
fn test_resolve_uses_the_resolver_chain() {
  let fs = Arc::new(OverlayFileSystem::new());
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  let package = root.join(Path::new("resolve-fixture/node_modules/pkg"));
  fs.create_dir_all(package).unwrap();
  fs.write(
    package.child("package.json"),
    &br#"{"name": "pkg", "exports": {"my-condition": "./custom-condition.js", "import": "./esm.js", "require": "./cjs.js"}}"#.to_vec(),
  )
  .unwrap();
  for file in ["esm.js", "cjs.js", "custom-condition.js"] {
    fs.write(package.child(file), &b"".to_vec()).unwrap();
  }
  let from = root.join(Path::new("resolve-fixture/index.js"));
  fs.write(from, &b"".to_vec()).unwrap();
  fs.write(root.join(Path::new("resolve-fixture/pkg")), &b"".to_vec())
    .unwrap();
  fs.write(
    root.join(Path::new("resolve-fixture/data.txt")),
    &b"".to_vec(),
  )
  .unwrap();

  let plugin_path = root.join(Path::new("resolve-specifier-type.mjs"));
  fs.write(
    plugin_path,
    &br#"
      import assert from 'assert';
      export default {[Symbol.for('parcel.plugin.v3.transformer')]: {
        async transform({asset, resolve}) {
          let from = asset.filePath;
          let path = async (...args) => (await resolve(...args)).filePath;
          let resolved = await resolve(from, 'pkg');
          assert.match(resolved.filePath, /node_modules\/pkg\/esm\.js$/);
          assert.equal(resolved.pipeline, null);
          assert.equal(resolved.query, null);
          assert.equal(resolved.sideEffects, true);
          assert.match(await path(from, 'pkg', {specifierType: 'esm'}), /node_modules\/pkg\/esm\.js$/);
          assert.match(await path(from, 'pkg', {specifierType: 'commonjs'}), /node_modules\/pkg\/cjs\.js$/);
          // A bare URL is relative, so this is the sibling file rather than the package.
          assert.match(await path(from, 'pkg', {specifierType: 'url', importType: 'url'}), /resolve-fixture\/pkg$/);
          // Only files with a transformer can be resolved as JavaScript.
          await assert.rejects(resolve(from, './data.txt'), /No transformers found for .*data\.txt/);
          assert.match(await path(from, './data.txt', {importType: 'url'}), /resolve-fixture\/data\.txt$/);
          assert.throws(() => resolve(from, './data.txt', {importType: 'nope'}), /Invalid importType/);
          // Conditions Parcel has no flag for still reach the resolvers.
          assert.match(await path(from, 'pkg', {packageConditions: ['my-condition']}), /custom-condition\.js$/);
          // Custom specifiers are for resolver plugins to interpret.
          assert.match(await path(from, 'pkg', {specifierType: 'custom'}), /resolve-fixture\/custom\.js$/);
          // A failure carries the resolvers' diagnostics, which rethrowing would report unchanged.
          await assert.rejects(resolve(from, 'missing'), error => {
            assert.match(error.message, /Failed to resolve 'missing'/);
            assert.equal(error.name, 'Diagnostic');
            assert.match(error.diagnostics[0].message, /Failed to resolve 'missing'/);
            assert.equal(error[Symbol.for('parcel-diagnostics')], error.diagnostics);
            return true;
          });
          assert.throws(() => resolve(from, 'pkg', {specifierType: 'nope'}), /Invalid specifierType/);
        }
      }};
    "#
    .to_vec(),
  )
  .unwrap();

  let mut asset = test_asset();
  asset.loc.url = SourceUrl::from_path(&from);
  let plugin = JsPlugin::new(plugin_path, "test-plugin", None);
  let dyn_fs: Arc<dyn FileSystem> = fs.clone();
  let options = ParcelOptions {
    input_fs: fs,
    ..Default::default()
  };
  let resolvers: Vec<Arc<dyn parcel_core::Resolver>> = vec![Arc::new(NodeResolver)];
  let transformers = transformers("*.js");
  let context =
    parcel_core::PluginContext::new(&options, &dyn_fs).with_resolvers(&resolvers, &transformers);
  plugin.transform(asset, &context).unwrap();
}

#[test]
fn test_resolve_runs_javascript_resolvers() {
  let fs = Arc::new(OverlayFileSystem::new());
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  fs.create_dir_all(root).unwrap();
  let resolver_path = root.join(Path::new("reentrant-resolver.mjs"));
  fs.write(
    resolver_path,
    test_utils::js(
      r#"
      export default {[Symbol.for('parcel.plugin.v3.resolver')]: {
        async resolve({specifier}) {
          await Promise.resolve();
          if (specifier === 'fails') throw new Error('resolver failed');
          if (specifier === 'virtual') return {filePath: this.path(globalThis.transformerState)};
          if (specifier === 'external') return {isExternal: true};
          if (specifier === 'excluded') return {isExcluded: true};
          return null;
        },
        // Methods are called with the plugin object as `this`.
        path(name) {
          return testPath('/virtual/') + name;
        }
      }};
    "#,
    )
    .as_bytes(),
  )
  .unwrap();
  let plugin_path = root.join(Path::new("reentrant-transformer.mjs"));
  fs.write(
    plugin_path,
    test_utils::js(r#"
      import assert from 'assert';
      export default {[Symbol.for('parcel.plugin.v3.transformer')]: {
        async transform({asset, resolve}) {
          // The resolver runs while this transformer is on the stack, in the same runtime.
          globalThis.transformerState = 'from-transformer';
          let pending = Promise.resolve('still pending');
          assert.equal((await resolve(asset.filePath, 'virtual')).filePath, testPath('/virtual/from-transformer'));
          await assert.rejects(resolve(asset.filePath, 'fails'), /resolver failed/);
          assert.deepEqual(await resolve(asset.filePath, 'external'), {isExternal: true});
          assert.deepEqual(await resolve(asset.filePath, 'excluded'), {isExcluded: true});
          assert.equal(await pending, 'still pending');
          asset.setCode((await resolve(asset.filePath, 'virtual')).filePath);
        }
      }};
    "#).as_bytes(),
  )
  .unwrap();

  let plugin = JsPlugin::new(plugin_path, "test-plugin", None);
  let dyn_fs: Arc<dyn FileSystem> = fs.clone();
  let options = ParcelOptions {
    input_fs: fs,
    ..Default::default()
  };
  let resolvers: Vec<Arc<dyn parcel_core::Resolver>> = vec![Arc::new(JsPlugin::new(
    resolver_path,
    "test-resolver",
    None,
  ))];
  let transformers = transformers("*");
  let context =
    parcel_core::PluginContext::new(&options, &dyn_fs).with_resolvers(&resolvers, &transformers);
  let asset = plugin.transform(test_asset(), &context).unwrap();
  assert_eq!(
    asset.content.read().unwrap(),
    test_utils::path("/virtual/from-transformer")
      .to_str()
      .unwrap()
      .as_bytes()
  );
}

#[test]
fn test_plugin_registered_for_another_parcel_or_kind_is_rejected() {
  // A plugin written for Parcel 2 registers under a key Parcel 3 doesn't read.
  let error = run(
    "v2-plugin.cjs",
    r#"
    module.exports = {[Symbol.for('parcel-plugin-config')]: {
      transform({asset}) { return [asset]; }
    }};
  "#,
    test_asset(),
  )
  .unwrap_err();
  assert_eq!(
    error.0[0].message,
    "test-plugin is not a valid Parcel transformer plugin"
  );
  assert!(
    error.0[0]
      .hints
      .iter()
      .any(|hint| hint.contains("new Transformer"))
  );

  let error = run(
    "resolver-as-transformer.mjs",
    r#"
    import {Resolver} from '@parcel/plugin';
    export default new Resolver({resolve() { return null; }});
  "#,
    test_asset(),
  )
  .unwrap_err();
  assert_eq!(
    error.0[0].message,
    "test-plugin is not a valid Parcel transformer plugin"
  );
  assert!(
    error.0[0]
      .hints
      .contains(&"It is a resolver plugin.".to_owned())
  );
}

#[test]
fn test_transform_is_called_with_the_plugin_as_this() {
  let result = run(
    "this.mjs",
    r#"
    import {Transformer} from '@parcel/plugin';
    export default new Transformer({
      transform({asset}) {
        asset.setCode(this.shout(asset.getCode()));
      },
      shout(code) {
        return code.toUpperCase();
      }
    });
  "#,
    test_asset(),
  )
  .unwrap();
  assert_eq!(result.content.read().unwrap(), b"HELLO");
}

#[test]
fn test_promise_that_never_settles() {
  let error = run(
    "never-settles.mjs",
    r#"
    import {Transformer} from '@parcel/plugin';
    export default new Transformer({
      transform() {
        return new Promise(() => {});
      }
    });
  "#,
    test_asset(),
  )
  .unwrap_err();
  assert!(
    error.0[0].message.contains("promise never settled"),
    "got: {}",
    error.0[0].message
  );
}

#[test]
fn test_source_maps_in_every_form() {
  use parcel_core::ContentWithSourceMap;
  for (form, map) in [
    ("object", "map"),
    ("string", "JSON.stringify(map)"),
    ("bytes", "new TextEncoder().encode(JSON.stringify(map))"),
  ] {
    let result = run(
      &format!("map-{form}.mjs"),
      &format!(
        r#"
        import {{Transformer}} from '@parcel/plugin';
        import assert from 'assert';
        export default new Transformer({{
          transform({{asset}}) {{
            const map = {{version: 3, sources: ['a.js'], names: [], mappings: 'AAAA'}};
            asset.setCode('code', {map});
            assert.deepEqual(asset.getMap(), map);
            assert.throws(() => asset.setCode('code', '{{not json'), TypeError);
            assert.throws(() => asset.setCode('code', '[1]'), TypeError);
            assert.throws(() => asset.setCode('code', 42), TypeError);
          }}
        }});
      "#
      ),
      test_asset(),
    )
    .unwrap();
    let map = result
      .content
      .downcast_ref::<ContentWithSourceMap>()
      .unwrap()
      .source_map();
    let map: serde_json::Value = serde_json::from_slice(map).unwrap();
    assert_eq!(map["sources"][0], "a.js", "{form}");
  }
}

#[test]
fn test_runtimes_are_kept_per_file_system() {
  let code = r#"
    import {Transformer} from '@parcel/plugin';
    let calls = 0;
    export default new Transformer({
      transform({asset}) {
        asset.setCode(String(++calls));
      }
    });
  "#;
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  let first = Arc::new(OverlayFileSystem::new());
  let second = Arc::new(OverlayFileSystem::new());
  first.create_dir_all(root).unwrap();
  second.create_dir_all(root).unwrap();
  let calls = |fs: &Arc<OverlayFileSystem>| {
    let asset = run_with_fs(fs.clone(), "per-fs.mjs", code).unwrap();
    String::from_utf8(asset.content.read().unwrap().to_vec()).unwrap()
  };
  // Switching to another file system and back keeps the first runtime, and its module state.
  assert_eq!(calls(&first), "1");
  assert_eq!(calls(&second), "1");
  assert_eq!(calls(&first), "2");
  assert_eq!(calls(&second), "2");
}
