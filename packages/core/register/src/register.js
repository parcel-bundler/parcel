// @flow strict-local

import type {IDisposable, InitialParcelOptions} from '@parcel/types';

import {NodePackageManager} from '@parcel/package-manager';
import {NodeFS} from '@parcel/fs';
// flowlint-next-line untyped-import:off
import defaultConfigContents from '@parcel/config-default';
// $FlowFixMe Flow can't resolve this
import Module from 'module';
import path from 'path';
import {addHook} from 'pirates';
import {ParcelNode} from '@parcel/node';

let hooks = {};
let lastDisposable;

function register(inputOpts?: InitialParcelOptions): IDisposable {
  // Replace old hook, as this one likely contains options.
  if (lastDisposable) {
    lastDisposable.dispose();
  }

  let parcel = new ParcelNode({
    logLevel: 'error',
    defaultConfig: require.resolve('@parcel/config-default'),
    ...inputOpts,
  });

  let env = {
    context: 'node',
    engines: {
      node: process.versions.node,
    },
  };

  let isProcessing = false;

  function fileProcessor(code, filePath) {
    if (isProcessing) {
      return code;
    }

    try {
      isProcessing = true;
      let {code} = parcel.transform(filePath);
      return code;
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

  function resolveFile(currFile, targetFile) {
    try {
      isProcessing = true;
      let resolved = parcel.resolve(targetFile, currFile);

      let targetFileExtension = path.extname(resolved);
      if (!hooks[targetFileExtension]) {
        hooks[targetFileExtension] = addHook(fileProcessor, {
          exts: [targetFileExtension],
          ignoreNodeModules: false,
        });
      }

      return resolved;
    } finally {
      isProcessing = false;
    }
  }

  hooks.js = addHook(fileProcessor, {
    exts: ['.js'],
    ignoreNodeModules: false,
  });

  let disposed;

  // Patching Module._resolveFilename takes care of patching the underlying
  // resolver in both `require` and `require.resolve`:
  // https://github.com/nodejs/node-v0.x-archive/issues/1125#issuecomment-10748203
  const originalResolveFilename = Module._resolveFilename;
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
register.dispose = disposable.dispose;

// Support both commonjs and ES6 modules
module.exports = register;
exports.default = register;
exports.__esModule = true;
