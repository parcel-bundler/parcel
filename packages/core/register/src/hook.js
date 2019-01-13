import Module from 'module';
import process from 'process';
import path from 'path';
import fs from 'fs';
import {addHook} from 'pirates';
import resolveFrom from 'resolve-from';

import Parcel, {Asset, Dependency, Environment} from '@parcel/core';
import syncPromise from '@parcel/utils/lib/syncPromise';
import {loadConfig} from '@parcel/utils/lib/config';

const originalRequire = Module.prototype.require;
const DEFAULT_CLI_OPTS = {
  watch: false
};

let hooks = {};
let parcelDeps = [];

function isParcelDep(filename) {
  if (parcelDeps.includes(filename)) {
    return true;
  }

  let loadedConfig = syncPromise(loadConfig(filename, ['package.json']));
  if (loadedConfig === null) {
    return false;
  }
  let pkg = loadedConfig.config;
  return pkg && (pkg.name.includes('@parcel') || pkg.name.includes('parcel-'));
}

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

  // As Parcel is pretty much fully asynchronous, create an async function and wrap it in a syncPromise later...
  async function fileProcessor(code, filename) {
    if (isParcelDep(filename)) {
      return code;
    }

    try {
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
      console.error('@parcel/register failed to process: ', filename);
      console.error(e);
    }

    return '';
  }

  let hookFunction = (...args) => syncPromise(fileProcessor(...args));

  function resolveFile(filename, filePath) {
    let resolvedFilePath = null;
    try {
      resolvedFilePath = resolveFrom(path.dirname(filename), filePath);
      if (isParcelDep(resolvedFilePath)) {
        return filePath;
      }
    } catch (e) {
      // Do nothing, maybe the parcel resolver can resolve this require
    }

    if (!isParcelDep(filename)) {
      let dep = new Dependency({
        moduleSpecifier: filePath,
        sourcePath: filename
      });

      filePath = syncPromise(parcel.resolverRunner.resolve(dep));

      let fileExtension = path.extname(filePath);
      if (!hooks[fileExtension]) {
        hooks[fileExtension] = addHook(hookFunction, {
          exts: [fileExtension],
          ignoreNodeModules: false
        });
      }
    } else {
      if (!parcelDeps.includes(filename)) {
        parcelDeps.push(filename);
      }

      filePath = resolvedFilePath
        ? resolvedFilePath
        : resolveFrom(path.dirname(filename), filePath);
      if (!parcelDeps.includes(filePath)) {
        parcelDeps.push(filePath);
      }
    }

    return filePath;
  }

  Module.prototype.require = function(filePath, ...args) {
    return originalRequire.bind(this)(
      resolveFile(this.filename, filePath),
      ...args
    );
  };
}

// Hook into require, this will be overwritten whenever it is called again or explicitly called with opts
register();
