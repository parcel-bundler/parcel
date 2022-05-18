// @flow strict-local

import {Runtime} from '@parcel/plugin';
import fs from 'fs';
import path from 'path';

const HMR_RUNTIME = fs.readFileSync(
  path.join(__dirname, './loaders/hmr-runtime.js'),
  'utf8',
);

export default (new Runtime({
  apply({bundle, options}) {
    if (
      bundle.type !== 'js' ||
      !options.hmrOptions ||
      bundle.env.isLibrary ||
      bundle.env.isWorklet() ||
      bundle.env.sourceType === 'script'
    ) {
      return;
    }

    const {host, port, https} = options.hmrOptions;
    return {
      filePath: __filename,
      code:
        `var HMR_HOST = ${JSON.stringify(host != null ? host : null)};` +
        `var HMR_HOST = ${JSON.stringify(host)};` +
        `var HMR_PORT = ${JSON.stringify(port)};` +
        `var HMR_SECURE = ${JSON.stringify(!!(https))};` +
        `var HMR_ENV_HASH = "${bundle.env.id}";` +
        `module.bundle.HMR_BUNDLE_ID = ${JSON.stringify(bundle.id)};` +
        HMR_RUNTIME,
      isEntry: true,
      env: {
        sourceType: 'module',
      },
    };
  },
}): Runtime);
