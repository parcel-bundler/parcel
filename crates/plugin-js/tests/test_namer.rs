use std::{borrow::Cow, collections::HashMap, path::Path, sync::Arc};

use parcel_core::{
  Asset, AssetFlags, AssetGraph, AssetNode, AssetType, BufferContent, Bundle, BundleBehavior,
  BundleFlags, BundleGraph, FileSystem, Namer, OverlayFileSystem, ParcelOptions, PathId,
  SourceLocation, SourceUrl, Target,
};
use parcel_plugin_js::JsPlugin;

fn run(name: &str, code: &str) -> Option<PathId> {
  run_times(name, code, 1)
}

fn run_times(name: &str, code: &str, times: usize) -> Option<PathId> {
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
      class Namer { constructor(opts) { this[CONFIG] = opts; } }
      module.exports = {Namer};
    "#
    .to_vec(),
  )
  .expect("Error writing plugin API");

  let target = Arc::new(Target {
    dist_dir: PathId::new(Path::new("/dist")),
    public_url: "/assets".into(),
    ..Default::default()
  });
  let assets = vec![
    AssetNode::Asset(test_asset(
      "file:///src/index.js",
      AssetType::Js,
      target.clone(),
    )),
    AssetNode::Asset(test_asset(
      "file:///src/style.css",
      AssetType::Css,
      target.clone(),
    )),
  ];
  let bundles = vec![
    Bundle {
      ty: AssetType::Js,
      target: target.clone(),
      bundle_behavior: BundleBehavior::None,
      flags: BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME,
      dist_path: None,
      assets: vec![0],
      entry_assets: vec![0],
      main_entry_asset: Some(0),
      referenced_bundles: vec![1],
    },
    Bundle {
      ty: AssetType::Css,
      target,
      bundle_behavior: BundleBehavior::Isolated,
      flags: BundleFlags::empty(),
      dist_path: None,
      assets: vec![1],
      entry_assets: vec![1],
      main_entry_asset: Some(1),
      referenced_bundles: vec![],
    },
  ];
  let graph = BundleGraph::new(
    AssetGraph {
      assets: Cow::Owned(assets),
      entries: Cow::Owned(vec![]),
    },
    bundles,
    HashMap::new(),
    PathId::new(Path::new("/")),
  );
  let plugin = JsPlugin::new(plugin_path);
  let options = ParcelOptions {
    input_fs: fs,
    ..Default::default()
  };
  (0..times)
    .map(|_| plugin.name(&graph, &graph.bundles[0], &options).unwrap())
    .last()
    .flatten()
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
fn test_namer_esm() {
  let result = run(
    "namer.mjs",
    r#"
      import {Namer} from '@parcel/plugin';
      import assert from 'assert';

      export default new Namer({
        name({bundle, bundleGraph}) {
          assert.equal(bundle.type, 'js');
          assert.equal(bundle.needsStableName, true);
          assert.equal(bundle.isEntry, true);
          assert.equal(bundle.bundleBehavior, null);
          assert.equal(bundle.target.distDir, '/dist');
          assert.equal(bundle.target.publicUrl, '/assets');
          assert.equal(bundle.getMainEntry().url, 'file:///src/index.js');
          assert.equal(bundle.getEntryAssets()[0].type, 'js');
          assert.equal(bundleGraph.getBundles().length, 2);
          assert.equal(bundleGraph.getEntryBundles().length, 1);
          let referenced = bundleGraph.getReferencedBundles(bundle);
          assert.equal(referenced.length, 1);
          assert.equal(referenced[0].type, 'css');
          assert.equal(referenced[0].bundleBehavior, 'isolated');
          return `custom/${bundle.getMainEntry().type}.${bundle.type}`;
        }
      });
    "#,
  );

  assert_eq!(result, Some(PathId::new(Path::new("/dist/custom/js.js"))));
}

#[test]
fn test_namer_cjs_async() {
  let result = run(
    "namer.cjs",
    r#"
      const {Namer} = require('@parcel/plugin');

      module.exports = new Namer({
        async name({bundle}) {
          await Promise.resolve();
          return `async.${bundle.type}`;
        }
      });
    "#,
  );

  assert_eq!(result, Some(PathId::new(Path::new("/dist/async.js"))));
}

#[test]
fn test_namer_can_defer() {
  let result = run(
    "namer.mjs",
    r#"
      import {Namer} from '@parcel/plugin';
      export default new Namer({name() { return null; }});
    "#,
  );

  assert_eq!(result, None);
}

#[test]
fn test_namer_wrappers_expire_after_call() {
  let result = run_times(
    "namer.cjs",
    r#"
      const {Namer} = require('@parcel/plugin');
      let savedBundle;
      let calls = 0;

      module.exports = new Namer({
        name({bundle}) {
          calls++;
          if (calls === 1) {
            savedBundle = bundle;
            return null;
          }

          let message;
          try {
            savedBundle.type;
          } catch (err) {
            message = err.message;
          }
          if (!message?.includes('plugin call has completed')) {
            throw new Error(`Expected expired wrapper error, got: ${message}`);
          }
          return `guarded.${bundle.type}`;
        }
      });
    "#,
    2,
  );

  assert_eq!(result, Some(PathId::new(Path::new("/dist/guarded.js"))));
}
