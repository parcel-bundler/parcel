// @flow strict-local

import type {InitialParcelOptions} from '@parcel/types';

import {register as _register} from '@parcel/core';
// $FlowFixMe this is untyped
import defaultConfigContents from '@parcel/config-default';

let defaultConfig = {
  ...defaultConfigContents,
  filePath: require.resolve('@parcel/config-default')
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
