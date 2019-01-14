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
let parcelModuleDirs = [];

function getPkgUp(filename) {
  return syncPromise(loadConfig(filename, ['package.json']));
}

function getModuleDir(filename) {
  let pkg = getPkgUp(filename);
  if (!pkg || !pkg.files[0]) {
    return null;
  }

  return path.dirname(pkg.files[0].filePath);
}

function isParcelModule(filename) {
  return !!parcelModuleDirs.find(moduleDir => filename.startsWith(moduleDir));
}

function isParcelDep(filename) {
  if (isParcelModule(filename)) {
    return true;
  }

  let loadedConfig = getPkgUp(filename);
  if (loadedConfig === null) {
    return false;
  }

  let pkg = loadedConfig.config;
  return pkg && (pkg.name.includes('@parcel') || pkg.name.includes('parcel-'));
}

function addParcelModuleDir(filename) {
  if (!filename) {
    return;
  }

  let moduleDir = getModuleDir(filename);
  if (!parcelModuleDirs.includes(moduleDir)) {
    parcelModuleDirs.push(moduleDir);
  }
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

  function resolveFile(currFile, targetFile) {
    let resolvedTargetFile;
    try {
      resolvedTargetFile = resolveFrom(path.dirname(currFile), targetFile);
    } catch (e) {
      resolvedTargetFile = e;
    }

    if (
      !isParcelDep(currFile) &&
      (resolvedTargetFile instanceof Error || !isParcelDep(resolvedTargetFile))
    ) {
      let dep = new Dependency({
        moduleSpecifier: targetFile,
        sourcePath: currFile
      });

      targetFile = syncPromise(parcel.resolverRunner.resolve(dep));

      let targetFileExtension = path.extname(targetFile);
      if (!hooks[targetFileExtension]) {
        hooks[targetFileExtension] = addHook(hookFunction, {
          exts: [targetFileExtension],
          ignoreNodeModules: false
        });
      }
    } else {
      if (resolvedTargetFile instanceof Error) {
        throw resolvedTargetFile;
      }

      addParcelModuleDir(currFile);
      addParcelModuleDir(resolvedTargetFile);
    }

    return targetFile;
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
