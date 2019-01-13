import Module from 'module';
import process from 'process';
import path from 'path';
import fs from 'fs';
import {addHook} from 'pirates';

import Parcel, {Asset, createDependency} from '@parcel/core';
import Cache from '@parcel/cache';
import syncPromise from '@parcel/utils/lib/syncPromise';
import {loadConfig} from '@parcel/utils/lib/config';

let hooks = {};
const originalRequire = Module.prototype.require;
const DEFAULT_CLI_OPTS = {
  watch: false
};

function isParcelDep(filename) {
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

  let cache = new Cache(opts);

  let environment = {
    context: 'node',
    engines: {
      node: process.versions.node
    }
  };

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

  let hookFunction = (...args) => syncPromise(fileProcessor(...args));

  Module.prototype.require = function(filePath, ...args) {
    if (!isParcelDep(this.filename)) {
      let dep = createDependency(
        {
          moduleSpecifier: filePath
        },
        this.filename
      );

      filePath = syncPromise(parcel.resolverRunner.resolve(dep));
    }

    let fileExtension = path.extname(filePath);
    if (!hooks[fileExtension]) {
      hooks[fileExtension] = addHook(hookFunction, {
        exts: [fileExtension],
        ignoreNodeModules: true // TODO: Figure out how to make this work without processing babel, postcss, ...
      });
    }

    return originalRequire.bind(this)(filePath, ...args);
  };
}

// Hook into require, this will be overwritten whenever it is called again or explicitly called with opts
register();
