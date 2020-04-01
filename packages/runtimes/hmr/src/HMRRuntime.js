// @flow strict-local

import {Runtime} from '@parcel/plugin';
import fs from 'fs';
import {md5FromObject} from '@parcel/utils';
import path from 'path';

const HMR_RUNTIME = fs.readFileSync(
  path.join(__dirname, './loaders/hmr-runtime.js'),
  'utf8',
);

export default new Runtime({
  apply({bundle, options}) {
    if (bundle.type !== 'js' || !options.hot) {
      return;
    }

    const {host, port} = options.hot;
    return {
      filePath: __filename,
      code:
        `var __PARCEL_HMR_HOST = ${JSON.stringify(
          host != null ? host : null,
        )};` +
        `var __PARCEL_HMR_PORT = ${JSON.stringify(
          port != null ? port : null,
        )};` +
        `var __PARCEL_BUNDLE_ID = ${JSON.stringify(bundle.id)};` +
        `var __PARCEL_HMR_ENV_HASH = "${md5FromObject(bundle.env)}";` +
        HMR_RUNTIME,
      isEntry: true,
    };
  },
});
