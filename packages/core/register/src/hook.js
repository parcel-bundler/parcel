import Parcel from '@parcel/core';
import {addHook} from 'pirates';
import process from 'process';
import path from 'path';
import fs from 'fs';
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
    let isInMonorepo =
      filename.includes('parcel/packages') &&
      !filename.includes('core/register');
    if (filename.includes('@parcel') || isInMonorepo) {
      return code;
    }

    try {
      let result = syncPromise(
        parcel.runTransform({
          filePath: filename,
          env: {
            context: 'node',
            engines: {}
          }
        })
      );

      if (result.assets && result.assets.length >= 1) {
        let codePath =
          (result.assets[0].output && result.assets[0].output.code) ||
          result.assets[0].code ||
          '';

        // Read blobs, replace with cache.readBlobs in the future.
        let codeContent = fs.readFileSync(
          path.join(process.cwd(), '.parcel-cache', codePath),
          'utf-8'
        );

        return codeContent;
      }
    } catch (e) {
      console.error('@parcel/register failed to process: ', filename);
      console.error(e);
    }

    return '';
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
    ignoreNodeModules: true
  });
}

// Hook into require, this will be overwritten whenever it is called again or explicitly called with opts
register();
