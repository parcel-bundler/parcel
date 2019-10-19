// @flow strict-local

import {Runtime} from '@parcel/plugin';
import path from 'path';
import invariant from 'assert';

export default new Runtime({
  apply({bundle, options}) {
    if (bundle.type !== 'js' || !bundle.env.isBrowser() || !options.hot) {
      return;
    }

    let mainEntry = bundle.getMainEntry();
    let code;
    if (mainEntry && mainEntry.meta.reactRefreshRuntimePath !== undefined) {
      let runtime = mainEntry.meta.reactRefreshRuntimePath;
      invariant(typeof runtime === 'string');

      code = `
var Refresh = require('${path.relative(__dirname, runtime)}');

Refresh.injectIntoGlobalHook(window);
window.$RefreshReg$ = function() {};
window.$RefreshSig$ = function() {
  return function(type) {
    return type;
  };
};`;

      return {
        filePath: __filename,
        code,
        isEntry: true
      };
    } else {
      // We don't need that in a child bundle (beacuse the main bundle will have set the global)
      return;
    }
  }
});
