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
    // Not sure if this should work?
    let result = syncPromise(
      parcel.transform(
        {
          filePath: filename,
          env: {
            context: 'node',
            engines: {} // TODO: figure this out
          }
        },
        {
          signal: {
            aborted: false
          }
        }
      )
    );

    return 'module.exports = null;';
  };
}

function register(opts = DEFAULT_CLI_OPTS) {
  // Replace old hook, as this one likely contains options.
  if (revert) {
    revert();
  }

  // Register the hook
  revert = addHook(fileHandler(opts), {
    // Parcel should handle all the files?
    matcher: () => true
  });
}

// Hook into require, this will be overwritten whenever it is called again or explicitly called with opts
register();

module.exports = register;
