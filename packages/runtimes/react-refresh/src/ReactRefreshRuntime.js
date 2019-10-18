// @flow strict-local

import {Runtime} from '@parcel/plugin';
import path from 'path';

export default new Runtime({
  async apply({bundle, options}) {
    if (bundle.type !== 'js' || !bundle.env.isBrowser() || !options.hot) {
      return;
    }

    let mainEntry = bundle.getMainEntry();
    let code;
    if (mainEntry) {
      let localRefreshRuntime = (await options.packageManager.resolve(
        'react-refresh/runtime',
        mainEntry.filePath
      )).resolved;
      code = `var Refresh = require('${path.relative(
        __dirname,
        localRefreshRuntime
      )}');

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
      // TODO I think we don't need that in a child bundle (beacuse the main bundle will have set the global)
      return;
    }
  }
});
