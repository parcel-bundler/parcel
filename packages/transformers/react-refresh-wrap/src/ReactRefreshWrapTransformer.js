// @flow

import path from 'path';
import {Transformer} from '@parcel/plugin';

function shouldExclude(asset, options) {
  return (
    !asset.isSource ||
    !options.hmrOptions ||
    !asset.env.isBrowser() ||
    asset.env.isWorker() ||
    asset.env.isWorklet() ||
    options.mode !== 'development' ||
    !asset
      .getDependencies()
      .find(v => v.specifier === 'react' || v.specifier === 'react/jsx-runtime')
  );
}

export default (new Transformer({
  async transform({asset, options}) {
    if (shouldExclude(asset, options)) {
      return [asset];
    }

    let wrapperPath = `@parcel/transformer-react-refresh-wrap/${path.basename(
      __dirname,
    )}/helpers/helpers.js`;

    let code = await asset.getCode();
    let map = await asset.getMap();
    let name = `$parcel$ReactRefreshHelpers$${asset.id.slice(-4)}`;

    code = `var ${name} = require(${JSON.stringify(wrapperPath)});
var prevRefreshReg = globalThis.$RefreshReg$;
var prevRefreshSig = globalThis.$RefreshSig$;
${name}.prelude(module);

try {
${code}
  ${name}.postlude(module);
} finally {
  globalThis.$RefreshReg$ = prevRefreshReg;
  globalThis.$RefreshSig$ = prevRefreshSig;
}`;

    asset.setCode(code);
    if (map) {
      map.offsetLines(1, 6);
      asset.setMap(map);
    }

    // The JSTransformer has already run, do it manually
    asset.addDependency({
      specifier: wrapperPath,
      specifierType: 'esm',
      resolveFrom: __filename,
    });

    asset.addDependency({
      specifier: 'react-native/Libraries/Utilities/DevSettings',
      specifierType: 'esm',
    });

    return [asset];
  },
}): Transformer);
