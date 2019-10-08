// @flow strict-local

import type {InitialParcelOptions} from '@parcel/types';

import {register as _register} from '@parcel/core';
import {NodePackageManager} from '@parcel/package-manager';
import {NodeFS} from '@parcel/fs';
// $FlowFixMe this is untyped
import defaultConfigContents from '@parcel/config-default';

let packageManager = new NodePackageManager(new NodeFS());
let defaultConfig = {
  ...defaultConfigContents,
  filePath: packageManager.resolveSync('@parcel/config-default', __filename)
    .resolved
};

function register(opts?: InitialParcelOptions) {
  return _register({
    defaultConfig,
    ...opts
  });
}

let disposable = register();
register.dispose = disposable.dispose;

// Support both commonjs and ES6 modules
exports = module.exports = register;
exports.default = register;
exports.__esModule = true;
