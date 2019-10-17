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
window.$RefreshReg$ = function(){};
window.$RefreshSig$ = function(){return function(type){return type};}

function debounce(func, delay) {
  var timeout = undefined;
  return function() {
    clearTimeout(timeout);
    timeout = setTimeout(function() {
      timeout = undefined;
      func();
    }, delay);
  }
}
window.parcelReactRefreshEnqueueUpdate = debounce(Refresh.performReactRefresh, 30);`;
    } else {
      code = `window.$RefreshReg$ = function(){};
window.$RefreshSig$ = function(){return function(type){return type};}`;
    }

    return {
      filePath: __filename,
      code,
      isEntry: true
    };
  }
});
