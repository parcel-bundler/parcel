// @flow strict-local

import {Runtime} from '@parcel/plugin';

export default new Runtime({
  apply({bundle, options}) {
    if (bundle.type !== 'js' || !bundle.env.isBrowser() || !options.hot) {
      return;
    }

    if (bundle.getMainEntry()) {
      return {
        filePath: __filename,
        code: `
var Refresh = require('react-refresh/runtime');

Refresh.injectIntoGlobalHook(window);
window.$RefreshReg$ = function() {};
window.$RefreshSig$ = function() {
  return function(type) {
    return type;
  };
};`,
        isEntry: true
      };
    } else {
      // We don't need that in a child bundle (beacuse the main bundle will have set the global)
      return;
    }
  }
});
