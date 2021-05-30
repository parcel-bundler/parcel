// @flow

import path from 'path';
import {Transformer} from '@parcel/plugin';
import {relativePath} from '@parcel/utils';

const WRAPPER = path.join(__dirname, 'helpers', 'helpers.js');

function shouldExclude(asset, options) {
  return (
    !asset.isSource ||
    !options.hmrOptions ||
    !asset.env.isBrowser() ||
    asset.env.isWorker() ||
    options.mode !== 'development' ||
    !asset.getDependencies().find(v => v.moduleSpecifier === 'react')
  );
}

export default (new Transformer({
  async transform({asset, options}) {
    if (shouldExclude(asset, options)) {
      return [asset];
    }

    let wrapperPath = relativePath(path.dirname(asset.filePath), WRAPPER);
    if (!wrapperPath.startsWith('.')) {
      wrapperPath = './' + wrapperPath;
    }

    let code = await asset.getCode();
    let map = await asset.getMap();

    code = `var helpers = require(${JSON.stringify(wrapperPath)});
var prevRefreshReg = window.$RefreshReg$;
var prevRefreshSig = window.$RefreshSig$;
helpers.prelude(module);

try {
${code}
  helpers.postlude(module);
} finally {
  window.$RefreshReg$ = prevRefreshReg;
  window.$RefreshSig$ = prevRefreshSig;
}`;

    asset.setCode(code);
    if (map) {
      map.offsetLines(1, 6);
      asset.setMap(map);
    }

    // The JSTransformer has already run, do it manually
    asset.addDependency({
      moduleSpecifier: wrapperPath,
    });

    return [asset];
  },
}): Transformer);
