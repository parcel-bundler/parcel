// @flow strict-local

import type {IDisposable, InitialParcelOptions} from '@parcel/types';

import {NodePackageManager} from '@parcel/package-manager';
import {NodeFS} from '@parcel/fs';
import type WorkerFarm from '@parcel/workers';
// flowlint-next-line untyped-import:off
import defaultConfigContents from '@parcel/config-default';
// $FlowFixMe Flow can't resolve this
import Module from 'module';
import path from 'path';
import {addHook} from 'pirates';
import Parcel, {INTERNAL_RESOLVE, INTERNAL_TRANSFORM} from '@parcel/core';

import syncPromise from './syncPromise';

let hooks = {};
let lastDisposable;
let packageManager = new NodePackageManager(new NodeFS(), '/');
let defaultConfig = {
  ...defaultConfigContents,
  filePath: packageManager.resolveSync('@parcel/config-default', __filename)
    .resolved,
};

function register(inputOpts?: InitialParcelOptions<WorkerFarm>): IDisposable {
  let opts: InitialParcelOptions<WorkerFarm> = {
    ...defaultConfig,
    ...(inputOpts || {}),
  };

  // Replace old hook, as this one likely contains options.
  if (lastDisposable) {
    lastDisposable.dispose();
  }

  let parcel = new Parcel({
    logLevel: 'error',
    ...opts,
  });

  let env = {
    context: 'node',
    engines: {
      node: process.versions.node,
    },
  };

  syncPromise(parcel._init());

  let isProcessing = false;

  // As Parcel is pretty much fully asynchronous, create an async function and wrap it in a syncPromise later...
  async function fileProcessor(code, filePath) {
    if (isProcessing) {
      return code;
    }

    try {
      isProcessing = true;
      // $FlowFixMe
      let result = await parcel[INTERNAL_TRANSFORM]({
        filePath,
        env,
      });

      if (result.assets && result.assets.length >= 1) {
        let output = '';
        let asset = result.assets.find(a => a.type === 'js');
        if (asset) {
          output = await asset.getCode();
        }
        return output;
      }
    } catch (e) {
      /* eslint-disable no-console */
      console.error('@parcel/register failed to process: ', filePath);
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

      let resolved = syncPromise(
        // $FlowFixMe
        parcel[INTERNAL_RESOLVE]({
          specifier: targetFile,
          sourcePath: currFile,
          env,
        }),
      );

      let targetFileExtension = path.extname(resolved);
      if (!hooks[targetFileExtension]) {
        hooks[targetFileExtension] = addHook(hookFunction, {
          exts: [targetFileExtension],
          ignoreNodeModules: false,
        });
      }

      return resolved;
    } finally {
      isProcessing = false;
    }
  }

  hooks.js = addHook(hookFunction, {
    exts: ['.js'],
    ignoreNodeModules: false,
  });

  let disposed;

  // Patching Module._resolveFilename takes care of patching the underlying
  // resolver in both `require` and `require.resolve`:
  // https://github.com/nodejs/node-v0.x-archive/issues/1125#issuecomment-10748203
  // $FlowFixMe[prop-missing]
  const originalResolveFilename = Module._resolveFilename;
  // $FlowFixMe[prop-missing]
  Module._resolveFilename = function parcelResolveFilename(to, from, ...rest) {
    return isProcessing || disposed
      ? originalResolveFilename(to, from, ...rest)
      : resolveFile(from?.filename, to);
  };

  let disposable = (lastDisposable = {
    dispose() {
      if (disposed) {
        return;
      }

      for (let extension in hooks) {
        hooks[extension]();
      }

      disposed = true;
    },
  });

  return disposable;
}

let disposable: IDisposable = register();
register.dispose = (): mixed => disposable.dispose();

// Support both commonjs and ES6 modules
module.exports = register;
exports.default = register;
exports.__esModule = true;
