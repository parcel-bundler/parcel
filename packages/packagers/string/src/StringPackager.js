// @flow strict-local

import assert from 'assert';
import {Packager} from '@parcel/plugin';

export default new Packager({
  async package({bundle}) {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.equal(
      assets.length,
      1,
      'String bundles must only contain one asset',
    );
    return {contents: await assets[0].getCode()};
  },
});
