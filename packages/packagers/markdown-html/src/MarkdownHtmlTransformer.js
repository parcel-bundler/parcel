// @flow
import assert from 'assert';
import {Packager} from '@parcel/plugin';
import {replaceURLReferences} from '@parcel/utils';
import Mustache from 'mustache';

export default new Packager({
  async package({bundle, bundleGraph}) {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.equal(assets.length, 1, 'MD bundles may only contain one asset');

    let asset = assets[0];
    let code = await asset.getCode();

    // Look for a template
    let bundles = bundleGraph.getSiblingBundles(bundle);
    if (bundles.length === 1) {
      let entryAsset = bundles[0].getMainEntry();
      if (entryAsset) {
        let template = await entryAsset.getCode();
        code = Mustache.render(template, {
          body: code,
          // $FlowFixMe
          ...asset.meta,
        });
      }
    }

    return replaceURLReferences({
      bundle,
      bundleGraph,
      contents: code,
    });
  },
});
