// @flow strict-local

import assert from 'assert';
import {Packager} from '@parcel/plugin';
import * as wasmmap from './wasm-sourcemap';

export default (new Packager({
  async package({bundle, getSourceMapReference}) {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.equal(assets.length, 1, 'Wasm bundles must only contain one asset');

    let [contents, map] = await Promise.all([
      assets[0].getBuffer(),
      assets[0].getMap(),
    ]);
    let sourcemapReference = await getSourceMapReference(map);
    if (sourcemapReference != null) {
      return {
        contents: Buffer.from(
          wasmmap.SetSourceMapURL(
            contents,
            sourcemapReference,
            sourcemapReference.includes('HASH_REF_')
              ? // HASH_REF_\w{16} -> \w{8}
                sourcemapReference.length - (9 + 16 - 8)
              : undefined,
          ),
        ),
        map,
      };
    } else {
      return {contents, map};
    }
  },
}): Packager);
