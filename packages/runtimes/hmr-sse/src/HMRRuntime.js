// @flow strict-local

import {Runtime} from '@parcel/plugin';
import fs from 'fs';
import path from 'path';

const HMR_RUNTIME = fs.readFileSync(
  path.join(__dirname, './loaders/hmr-runtime.js'),
  'utf8',
);

// $FlowFixMe
const DIRNAME = process.browser
  ? '/VIRTUAL/@parcel/runtime-hmr-sse/src'
  : __dirname;
// $FlowFixMe
const FILENAME = path.join(DIRNAME, 'HMRRuntime.js');

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

    const {host, port} = options.hmrOptions;
    return {
      filePath: FILENAME,
      code:
        `var HMR_HOST = ${JSON.stringify(host != null ? host : null)};` +
        `var HMR_PORT = ${JSON.stringify(
          port != null &&
            // Default to the HTTP port in the browser, only override
            // in watch mode or if hmr port != serve port
            (!options.serveOptions || options.serveOptions.port !== port)
            ? port
            : null,
        )};` +
        `var HMR_SECURE = ${JSON.stringify(
          !!(options.serveOptions && options.serveOptions.https),
        )};` +
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
