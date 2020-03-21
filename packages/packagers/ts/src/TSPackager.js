// @flow strict-local

import assert from 'assert';
import {Packager} from '@parcel/plugin';

export default new Packager({
  async package({bundle}) {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.equal(assets.length, 1, 'TS bundles must only contain one asset');
    let code = await assets[0].getCode();
    let map = await assets[0].getMap();

    return {contents: code, map};
  },
  async postProcess({contents, map, getSourceMapReference}) {
    // $FlowFixMe sketchy null checks are fun
    if (!map) return {contents, map};

    if (typeof contents !== 'string') {
      throw new Error('Contents should be a string!');
    }

    let sourcemapReference = await getSourceMapReference(map);
    return {
      contents:
        contents + '\n\n' + '//# sourceMappingURL=' + sourcemapReference + '\n',
      map,
    };
  },
});
