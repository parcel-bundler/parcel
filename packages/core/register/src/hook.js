import Parcel, {Asset} from '@parcel/core';
import Cache from '@parcel/cache';

import {addHook} from 'pirates';
import process from 'process';
import path from 'path';
import fs from 'fs';
import syncPromise from '@parcel/utils/lib/syncPromise';

let revert = null;
let cache = null;
const DEFAULT_CLI_OPTS = {
  watch: false
};

// The filehandler returns a function that transforms the code
function fileHandler(opts) {
  let parcel = new Parcel({
    entries: [path.join(process.cwd(), 'index.js')],
    cliOpts: opts
  });

  cache = new Cache(opts);

  // As Parcel is pretty much fully asynchronous, create an async function and return it wrapped in a syncPromise
  async function runner(code, filename) {
    try {
      let result = await parcel.runTransform({
        filePath: filename,
        env: {
          context: 'node',
          engines: {
            node: process.versions.node
          }
        }
      });

      if (result.assets && result.assets.length >= 1) {
        let asset = new Asset({...result.assets[0], cache});
        let output = await asset.getOutput();

        return output.code;
      }
    } catch (e) {
      console.error('@parcel/register failed to process: ', filename);
      console.error(e);
    }

    return '';
  }

  return (...args) => syncPromise(runner(...args));
}

function matcher(filename) {
  let isInMonorepo =
    filename.includes('parcel/packages') && !filename.includes('core/register');
  if (filename.includes('@parcel') || isInMonorepo) {
    return false;
  }
  return true;
}

export default function register(opts = DEFAULT_CLI_OPTS) {
  // Replace old hook, as this one likely contains options.
  if (revert) {
    revert();
  }

  // Register the hook
  revert = addHook(fileHandler(opts), {
    // Parcel should handle all the files?
    matcher,
    ignoreNodeModules: true
  });
}

// Hook into require, this will be overwritten whenever it is called again or explicitly called with opts
register();
