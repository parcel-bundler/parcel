// @flow strict-local

import {Runtime} from '@parcel/plugin';

const CODE = `
var Refresh = require('react-refresh/runtime');

Refresh.injectIntoGlobalHook(window);
window.$RefreshReg$ = function() {};
window.$RefreshSig$ = function() {
  return function(type) {
    return type;
  };
};`;

export default new Runtime({
  async apply({bundle, options}) {
    if (
      bundle.type !== 'js' ||
      !options.hot ||
      !bundle.env.isBrowser() ||
      options.mode !== 'development'
    ) {
      return;
    }

    let mainEntry = bundle.getMainEntry();
    if (mainEntry) {
      let pkg = await mainEntry.getPackage();
      if (pkg && pkg.dependencies && pkg.dependencies['react']) {
        return {
          filePath: __filename,
          code: CODE,
          isEntry: true,
        };
      }
    }
  },
});
