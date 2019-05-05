// @flow strict-local

import {Runtime} from '@parcel/plugin';
import {readFile} from '@parcel/fs';
import {md5FromObject} from '@parcel/utils/src/md5';
import path from 'path';

const HMR_RUNTIME = './loaders/hmr-runtime.js';

export default new Runtime({
  async apply(bundle, bundleGraph, options) {
    if (bundle.type !== 'js' || !options.hot) {
      return;
    }

    if (typeof options.hot !== 'object') {
      throw new Error(
        'options.hot should be an object, otherwise the HMR Runtime has no clue what port to use'
      );
    }

    return {
      filePath: __filename,
      code:
        `var __PARCEL_HMR_ENV_HASH = "${md5FromObject(bundle.env)}";` +
        (await readFile(path.join(__dirname, HMR_RUNTIME))).toString('utf8')
    };
  }
});
