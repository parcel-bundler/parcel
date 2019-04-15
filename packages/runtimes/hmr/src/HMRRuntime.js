// @flow
// import type {BundleGroupNode} from '@parcel/types';

import {Runtime} from '@parcel/plugin';
import {readFile} from '@parcel/fs';
import {md5FromObject} from '@parcel/utils/src/md5';
import path from 'path';

const HMR_RUNTIME = './loaders/hmr-runtime.js';

export default new Runtime({
  async apply(bundle, options) {
    if (bundle.type !== 'js' || !options.hot) {
      return;
    }

    if (typeof options.hot !== 'object') {
      throw new Error(
        'options.hot should be an object, otherwise the HMR Runtime has no clue what port to use'
      );
    }

    let root = Array.from(bundle.assetGraph.nodes.values()).find(
      asset => asset.type === 'root'
    );

    if (!root || !options.hot) return;

    // $FlowFixMe
    await bundle.assetGraph.addRuntimeAsset(root, {
      filePath: __filename,
      env: bundle.env,
      code:
        `var __PARCEL_HMR_ENV_HASH = "${md5FromObject(bundle.env)}";` +
        (await readFile(path.join(__dirname, HMR_RUNTIME))).toString('utf8')
    });
  }
});
