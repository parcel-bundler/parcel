use std::{borrow::Cow, collections::HashMap, path::Path, sync::Arc};

use parcel_core::{
  Asset, AssetFlags, AssetGraph, AssetIndex, AssetNode, AssetType, BufferContent, Bundle,
  BundleBehavior, BundleFlags, BundleGraph, Content, ContentWithSourceMap, FileSystem, Optimizer,
  OverlayFileSystem, ParcelOptions, PathId, SourceLocation, SourceUrl, Target,
};
use parcel_plugin_js::JsPlugin;

fn run(
  name: &str,
  code: &str,
  contents: Arc<dyn Content>,
  config: Option<serde_json::Value>,
) -> Arc<dyn Content> {
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
      class Optimizer { constructor(opts) { this[CONFIG] = opts; } }
      module.exports = {Optimizer};
    "#
    .to_vec(),
  )
  .expect("Error writing plugin API");

  let target = Arc::new(Target {
    dist_dir: PathId::new(Path::new("/dist")),
    public_url: "/assets".into(),
    ..Default::default()
  });
  let assets = vec![Asset {
    loc: SourceLocation {
      url: SourceUrl::parse("file:///src/index.js").unwrap(),
      ..Default::default()
    },
    ty: AssetType::Js,
    content: Arc::new(BufferContent::new(vec![])),
    target: target.clone(),
    pipeline: None,
    bundle_behavior: BundleBehavior::None,
    flags: AssetFlags::empty(),
    unique_key: None,
    dependencies: vec![],
    symbols: Default::default(),
  }];
  let bundles = vec![Bundle {
    id: 0,
    ty: AssetType::Js,
    target,
    bundle_behavior: BundleBehavior::None,
    flags: BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME,
    dist_path: None,
    assets: vec![AssetIndex::from_index(0)],
    entry_assets: vec![AssetIndex::from_index(0)],
    main_entry_asset: Some(AssetIndex::from_index(0)),
    referenced_bundles: vec![],
  }];
  let graph = BundleGraph::new(
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
  );
  let plugin = JsPlugin::new(plugin_path, config);
  let options = ParcelOptions {
    input_fs: fs,
    ..Default::default()
  };

  plugin
    .optimize(&graph, &graph.bundles[0], contents, &options)
    .unwrap()
}

#[test]
fn test_optimizer_esm_async_with_source_map() {
  let result = run(
    "optimizer.mjs",
    r#"
      import {Optimizer} from '@parcel/plugin';
      import assert from 'assert';

      export default new Optimizer({
        async optimize({bundle, bundleGraph, contents, map, config}) {
          await Promise.resolve();
          assert(contents instanceof Uint8Array);
          assert(map instanceof Uint8Array);
          assert.deepEqual([...contents], [...new TextEncoder().encode('hello')]);
          assert.deepEqual([...map], [1, 2, 3]);
          assert.deepEqual(config, {suffix: '!'});
          assert.equal(bundle.type, 'js');
          assert.equal(bundle.isEntry, true);
          assert.equal(bundle.getMainEntry().url, 'file:///src/index.js');
          assert.equal(bundleGraph.getBundles()[0].type, 'js');

          return {
            contents: new TextEncoder().encode(new TextDecoder().decode(contents) + config.suffix),
            map: new Uint8Array([4, 5, 6]),
          };
        }
      });
    "#,
    Arc::new(ContentWithSourceMap::new(b"hello".to_vec(), vec![1, 2, 3])),
    Some(serde_json::json!({"suffix": "!"})),
  );

  assert_eq!(result.read().unwrap(), b"hello!");
  assert_eq!(
    result
      .downcast_ref::<ContentWithSourceMap>()
      .unwrap()
      .source_map(),
    &[4, 5, 6]
  );
}

#[test]
fn test_optimizer_cjs_without_source_map() {
  let result = run(
    "optimizer.cjs",
    r#"
      const {Optimizer} = require('@parcel/plugin');
      const assert = require('assert');

      module.exports = new Optimizer({
        optimize({contents, map}) {
          assert(contents instanceof Uint8Array);
          assert.equal(map, null);
          return {contents: new Uint8Array([...contents, 33])};
        }
      });
    "#,
    Arc::new(BufferContent::new(b"hello".to_vec())),
    None,
  );

  assert_eq!(result.read().unwrap(), b"hello!");
  assert!(result.downcast_ref::<ContentWithSourceMap>().is_none());
}
