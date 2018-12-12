import Parcel from '@parcel/core';
import {addHook} from 'pirates';
import process from 'process';
import path from 'path';
import syncPromise from '@parcel/utils/lib/syncPromise';

let revert = null;
const DEFAULT_CLI_OPTS = {
  watch: false
};

// The filehandler returns a function that transforms the code
function fileHandler(opts) {
  let parcel = new Parcel({
    entries: [path.join(process.cwd(), 'index.js')],
    cliOpts: opts
  });

  return function(code, filename) {
    // TODO: Skip parcel's own code...

    try {
      // It appears pipeline always ends up being [undefined, undefined, undefined]
      // TODO: Figure out why this happens and fix it.
      let result = syncPromise(
        parcel.runTransform({
          filePath: filename,
          env: {
            context: 'node',
            engines: {}
          }
        })
      );

      console.log('Successfully compiled: ', filename);
      console.log(({assets, initialAssets} = result));
    } catch (e) {
      console.error('@parcel/register failed to process: ', filename);
      console.error(e);
    }

    // Fallback
    return 'module.exports = {};';
  };
}

export default function register(opts = DEFAULT_CLI_OPTS) {
  // Replace old hook, as this one likely contains options.
  if (revert) {
    revert();
  }

  // Register the hook
  revert = addHook(fileHandler(opts), {
    // Parcel should handle all the files?
    matcher: () => true,
    ignoreNodeModules: false
  });
}

// Hook into require, this will be overwritten whenever it is called again or explicitly called with opts
register();
