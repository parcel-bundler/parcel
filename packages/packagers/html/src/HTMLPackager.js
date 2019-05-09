// @flow strict-local

import assert from 'assert';
import {Packager} from '@parcel/plugin';

export default new Packager({
  package(bundle) {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.equal(assets.length, 1, 'HTML bundles must only contain one asset');
    return assets[0].getCode();
  }
});
