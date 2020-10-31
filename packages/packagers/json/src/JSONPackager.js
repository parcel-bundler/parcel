// @flow strict-local

import assert from 'assert';
import {Packager} from '@parcel/plugin';
import {replaceURLReferences} from '@parcel/utils';

export default (new Packager({
  async package({bundle, bundleGraph}) {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.equal(assets.length, 1, 'JSON bundles must only contain one asset');
    // TODO: try doing this with custom logic to avoid string splitting on JSON (unnecessary)
    let {contents} = replaceURLReferences({
      bundle,
      bundleGraph,
      contents: await assets[0].getCode(),
      relative: true,
    });
    return {contents};
  },
}): Packager);
