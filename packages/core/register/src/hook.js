import Module from 'module';
import process from 'process';
import path from 'path';
import {addHook} from 'pirates';
import Parcel, {Dependency, Environment} from '@parcel/core';
import syncPromise from '@parcel/utils/lib/syncPromise';

const originalRequire = Module.prototype.require;
const DEFAULT_CLI_OPTS = {
  watch: false
};

let hooks = {};

export default function register(opts = DEFAULT_CLI_OPTS) {
  // Replace old hook, as this one likely contains options.
  if (hooks) {
    for (let extension in hooks) {
      hooks[extension]();
    }
  }

  let parcel = new Parcel({
    entries: [path.join(process.cwd(), 'index.js')],
    cliOpts: opts
  });

  let environment = new Environment({
    context: 'node',
    engines: {
      node: process.versions.node
    }
  });

  syncPromise(parcel.init());

  let isProcessing = false;

  // As Parcel is pretty much fully asynchronous, create an async function and wrap it in a syncPromise later...
  async function fileProcessor(code, filename) {
    if (isProcessing) {
      return code;
    }

    try {
      isProcessing = true;
      let result = await parcel.runTransform({
        filePath: filename,
        env: environment
      });

      if (result.assets && result.assets.length >= 1) {
        let output = '';
        let asset = result.assets.find(a => a.type === 'js');
        if (asset) {
          output = (await asset.getOutput()).code;
        }
        return output;
      }
    } catch (e) {
      /* eslint-disable no-console */
      console.error('@parcel/register failed to process: ', filename);
      console.error(e);
      /* eslint-enable */
    } finally {
      isProcessing = false;
    }

    return '';
  }

  let hookFunction = (...args) => syncPromise(fileProcessor(...args));

  function resolveFile(currFile, targetFile) {
    try {
      isProcessing = true;
      let dep = new Dependency({
        moduleSpecifier: targetFile,
        sourcePath: currFile,
        env: environment
      });

      targetFile = syncPromise(parcel.resolverRunner.resolve(dep));

      let targetFileExtension = path.extname(targetFile);
      if (!hooks[targetFileExtension]) {
        hooks[targetFileExtension] = addHook(hookFunction, {
          exts: [targetFileExtension],
          ignoreNodeModules: false
        });
      }

      return targetFile;
    } finally {
      isProcessing = false;
    }
  }

  Module.prototype.require = function(filePath, ...args) {
    let resolved = filePath;
    if (!isProcessing) {
      resolved = resolveFile(this.filename, filePath);
    }

    return originalRequire.call(this, resolved, ...args);
  };
}

// Hook into require, this will be overwritten whenever it is called again or explicitly called with opts
register();
