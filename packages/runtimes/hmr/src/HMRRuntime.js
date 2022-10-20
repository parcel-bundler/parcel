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

    const {host, port} = options.hmrOptions;
    return {
      filePath: __filename,
      code:
        (bundle.env.isReactNative()
          ? `var RN_ORIGIN = PARCEL_getDevServer().url.replace(/https?:\\/\\//, '').replace(/\\/$/, '');` +
            `var HMR_HOST = RN_ORIGIN.split(":")[0];` +
            `var HMR_PORT = RN_ORIGIN.split(":")[1];`
          : `var HMR_HOST = ${JSON.stringify(host != null ? host : null)};` +
            `var HMR_PORT = ${JSON.stringify(
              port != null &&
                // Default to the HTTP port in the browser, only override
                // in watch mode or if hmr port != serve port
                (!options.serveOptions || options.serveOptions.port !== port)
                ? port
                : null,
            )};`) +
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
