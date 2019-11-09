// @flow

import {Transformer} from '@parcel/plugin';
import invariant from 'assert';

function shouldExclude(asset, options) {
  return !asset.env.isBrowser() || !options.hot || !asset.isSource;
}

export default new Transformer({
  async transform({asset, options}) {
    if (!shouldExclude(asset, options)) {
      let reactRefreshBabelPlugin = (await options.packageManager.resolve(
        'react-refresh/babel',
        __filename
      )).resolved;

      asset.meta.babelPlugins = asset.meta.babelPlugins || [];
      invariant(Array.isArray(asset.meta.babelPlugins));
      asset.meta.babelPlugins.push([
        reactRefreshBabelPlugin,
        {skipEnvCheck: true}
      ]);
    }
    return [asset];
  }
});
