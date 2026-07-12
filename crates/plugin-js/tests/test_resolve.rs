use std::{path::Path, sync::Arc};

use parcel_core::{
  BundleBehavior, Dependency, DependencyFlags, DependencyResolution, ExportsCondition, FileSystem,
  Location, OverlayFileSystem, ParcelOptions, PathId, Priority, Resolver, SourceLocation,
  SourceUrl, SpecifierType,
};
use parcel_plugin_js::JsPlugin;

fn run(
  name: &str,
  code: &str,
  dependency: Dependency,
  specifier: &str,
  pipeline: Option<&str>,
) -> Result<DependencyResolution, parcel_core::DiagnosticList> {
  run_times(name, code, dependency, specifier, pipeline, 1, None)
}

fn run_with_config(
  name: &str,
  code: &str,
  dependency: Dependency,
  specifier: &str,
  pipeline: Option<&str>,
  config: Option<serde_json::Value>,
) -> Result<DependencyResolution, parcel_core::DiagnosticList> {
  run_times(name, code, dependency, specifier, pipeline, 1, config)
}

fn run_times(
  name: &str,
  code: &str,
  dependency: Dependency,
  specifier: &str,
  pipeline: Option<&str>,
  times: usize,
  config: Option<serde_json::Value>,
) -> Result<DependencyResolution, parcel_core::DiagnosticList> {
  let fs = Arc::new(OverlayFileSystem::new());
  let root = PathId::new(Path::new(env!("CARGO_MANIFEST_DIR")));
  let plugin_path = root.join(Path::new(name));
  fs.create_dir_all(root).expect("Error creating dir");
  fs.write(plugin_path, &code.as_bytes().to_owned())
    .expect("Error writing plugin");
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
      class Resolver { constructor(opts) { this[CONFIG] = opts; } }
      module.exports = {Resolver};
    "#
    .to_vec(),
  )
  .expect("Error writing plugin API");

  let plugin = JsPlugin::new(plugin_path, config);
  let dyn_fs: Arc<dyn FileSystem> = fs.clone();
  let options = ParcelOptions {
    input_fs: fs,
    ..Default::default()
  };
  let mut result = None;
  for _ in 0..times {
    result = Some(plugin.resolve(&dependency, specifier, pipeline, &options, &dyn_fs));
  }
  result.expect("Resolver must be called at least once")
}

#[test]
fn test_resolver_config() {
  let result = run_with_config(
    "plugin-config.mjs",
    r#"
      import {Resolver} from '@parcel/plugin';
      import assert from 'assert';

      export default new Resolver({
        resolve({config}) {
          assert.deepEqual(config, {filePath: '/configured.js', enabled: true});
          return {filePath: config.filePath};
        }
      });
    "#,
    test_dependency(),
    "configured",
    None,
    Some(serde_json::json!({
      "filePath": "/configured.js",
      "enabled": true
    })),
  )
  .unwrap();

  assert!(matches!(result, DependencyResolution::Deferred(_)));
}

fn test_dependency() -> Dependency {
  Dependency {
    specifier: "original-specifier".into(),
    specifier_type: SpecifierType::Commonjs,
    priority: Priority::Lazy,
    bundle_behavior: BundleBehavior::Isolated,
    flags: DependencyFlags::ENTRY | DependencyFlags::OPTIONAL | DependencyFlags::NEEDS_STABLE_NAME,
    target: Arc::new(Default::default()),
    loc: Some(SourceLocation {
      url: SourceUrl::parse("file:///project/src/index.js").unwrap(),
      start: Location { line: 2, column: 3 },
      end: Location { line: 2, column: 9 },
    }),
    placeholder: None,
    resolve_from: Some(SourceUrl::parse("file:///project/src/index.js").unwrap()),
    range: Some("^1.2.3".into()),
    conditions: ExportsCondition::REQUIRE | ExportsCondition::BROWSER,
    resolution: DependencyResolution::None,
  }
}

#[test]
fn test_resolve_esm() {
  let result = run(
    "plugin.mjs",
    r#"
      import {Resolver} from '@parcel/plugin';
      import assert from 'assert';

      export default new Resolver({
        resolve({dependency, specifier, pipeline}) {
          assert.equal(specifier, 'resolved-specifier');
          assert.equal(pipeline, 'test');
          assert.equal(dependency.specifier, 'original-specifier');
          assert.equal(dependency.specifierType, 'commonjs');
          assert.equal(dependency.priority, 'lazy');
          assert.equal(dependency.bundleBehavior, 'isolated');
          assert.equal(dependency.isEntry, true);
          assert.equal(dependency.isOptional, true);
          assert.equal(dependency.needsStableName, true);
          assert.equal(dependency.resolveFrom, 'file:///project/src/index.js');
          assert.equal(dependency.loc.filePath, '/project/src/index.js');
          assert.deepEqual(dependency.loc.start, {line: 2, column: 3});
          assert.deepEqual(dependency.loc.end, {line: 2, column: 9});
          assert.deepEqual(dependency.packageConditions.sort(), ['browser', 'require']);
          assert.equal(dependency.range, '^1.2.3');
          assert.equal(dependency.target.environment, 'browser');
          assert.equal(dependency.target.outputFormat, 'global');

          return {
            filePath: '/project/src/result.css',
            pipeline: 'custom',
            query: new URLSearchParams('foo=bar&x=1'),
            sideEffects: false,
            code: 'body {}'
          };
        }
      });
    "#,
    test_dependency(),
    "resolved-specifier",
    Some("test"),
  )
  .unwrap();

  let DependencyResolution::Deferred(request) = result else {
    panic!("Expected deferred asset request");
  };
  assert_eq!(
    request.loc.url.to_string(),
    "file:///project/src/result.css?foo=bar&x=1"
  );
  assert_eq!(request.ty.extension(), "css");
  assert_eq!(request.pipeline.as_deref(), Some("custom"));
  assert!(!request.side_effects);
  assert_eq!(request.content.read().unwrap(), b"body {}".to_vec());
}

#[test]
fn test_resolve_cjs() {
  let result = run(
    "plugin.cjs",
    r#"
      const {Resolver} = require('@parcel/plugin');

      module.exports = new Resolver({
        resolve() {
          return {filePath: '/project/result.js'};
        }
      });
    "#,
    test_dependency(),
    "result",
    None,
  )
  .unwrap();

  let DependencyResolution::Deferred(request) = result else {
    panic!("Expected deferred asset request");
  };
  assert_eq!(request.loc.url.to_string(), "file:///project/result.js");
  assert!(request.side_effects);
}

#[test]
fn test_resolve_async() {
  let result = run(
    "plugin.mjs",
    r#"
      import {Resolver} from '@parcel/plugin';

      export default new Resolver({
        async resolve() {
          await Promise.resolve();
          return {filePath: '/project/async.js', code: 'async'};
        }
      });
    "#,
    test_dependency(),
    "async",
    None,
  )
  .unwrap();

  let DependencyResolution::Deferred(request) = result else {
    panic!("Expected deferred asset request");
  };
  assert_eq!(request.content.read().unwrap(), b"async".to_vec());
}

#[test]
fn test_dependency_wrapper_expires_after_call() {
  let result = run_times(
    "plugin.cjs",
    r#"
      const {Resolver} = require('@parcel/plugin');
      let savedDependency;
      let calls = 0;

      module.exports = new Resolver({
        resolve({dependency}) {
          calls++;
          if (calls === 1) {
            savedDependency = dependency;
            return null;
          }

          let message;
          try {
            savedDependency.specifier;
          } catch (err) {
            message = err.message;
          }
          if (!message?.includes('plugin call has completed')) {
            throw new Error(`Expected expired wrapper error, got: ${message}`);
          }
          return {filePath: '/project/guarded.js'};
        }
      });
    "#,
    test_dependency(),
    "guarded",
    None,
    2,
    None,
  )
  .unwrap();

  let DependencyResolution::Deferred(request) = result else {
    panic!("Expected deferred asset request");
  };
  assert_eq!(request.loc.url.to_string(), "file:///project/guarded.js");
}

#[test]
fn test_resolve_excluded() {
  let result = run(
    "plugin.mjs",
    r#"
      import {Resolver} from '@parcel/plugin';
      export default new Resolver({resolve() { return {isExcluded: true}; }});
    "#,
    test_dependency(),
    "external",
    None,
  )
  .unwrap();

  assert_eq!(result, DependencyResolution::External);
}

#[test]
fn test_resolve_none() {
  for result in ["null", "undefined", "{}"] {
    let code = format!(
      r#"
        import {{Resolver}} from '@parcel/plugin';
        export default new Resolver({{resolve() {{ return {result}; }}}});
      "#
    );
    assert_eq!(
      run("plugin.mjs", &code, test_dependency(), "unresolved", None).unwrap(),
      DependencyResolution::None
    );
  }
}

#[test]
fn test_resolve_clears_pipeline_and_has_null_bundle_behavior() {
  let mut dependency = test_dependency();
  dependency.bundle_behavior = BundleBehavior::None;
  let result = run(
    "plugin.mjs",
    r#"
      import {Resolver} from '@parcel/plugin';
      import assert from 'assert';
      export default new Resolver({
        resolve({dependency}) {
          assert.equal(dependency.bundleBehavior, null);
          return {filePath: '/project/result.js', pipeline: null, query: 'raw=query'};
        }
      });
    "#,
    dependency,
    "result",
    Some("incoming"),
  )
  .unwrap();

  let DependencyResolution::Deferred(request) = result else {
    panic!("Expected deferred asset request");
  };
  assert_eq!(request.pipeline, None);
  assert_eq!(
    request.loc.url.to_string(),
    "file:///project/result.js?raw=query"
  );
}

#[test]
fn test_resolve_rejects_relative_path() {
  let error = run(
    "plugin.mjs",
    r#"
      import {Resolver} from '@parcel/plugin';
      export default new Resolver({resolve() { return {filePath: 'relative.js'}; }});
    "#,
    test_dependency(),
    "result",
    None,
  )
  .unwrap_err();

  assert!(
    error.0[0]
      .message
      .contains("Resolvers must return an absolute path")
  );
}
