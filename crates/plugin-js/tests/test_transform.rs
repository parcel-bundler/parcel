use std::{path::Path, sync::Arc};

use parcel_core::{
  Asset, AssetFlags, AssetType, BufferContent, BundleBehavior, DiagnosticList, FileSystem,
  OverlayFileSystem, ParcelOptions, SourceLocation, SourceUrl, Transformer,
};
use parcel_plugin_js::JsPlugin;

fn run(name: &str, code: &str, asset: Asset) -> Result<Asset, DiagnosticList> {
  let fs = Arc::new(OverlayFileSystem::new());
  let root = env!("CARGO_MANIFEST_DIR");
  let plugin_path = Path::new(root).join(name);
  fs.create_dir_all(Path::new(root))
    .expect("Error creating dir");
  fs.write(&plugin_path, &code.as_bytes().to_owned())
    .expect("Error writing file");
  let plugin = JsPlugin::new(&plugin_path);
  plugin.transform(
    asset,
    &ParcelOptions {
      input_fs: fs.clone(),
      ..Default::default()
    },
  )
}

fn test_asset() -> Asset {
  Asset {
    loc: SourceLocation {
      url: SourceUrl::parse("project:///foo/bar.js").unwrap(),
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
      assert.equal(asset.url, 'project:///foo/bar.js');
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
      assert.equal(asset.url, 'project:///foo/bar.js');
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
