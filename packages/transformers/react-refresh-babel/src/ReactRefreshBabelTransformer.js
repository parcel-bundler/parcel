// @flow

import {Transformer} from '@parcel/plugin';
import invariant from 'assert';

async function shouldExclude(asset, options) {
  if (
    !asset.isSource ||
    !options.hot ||
    !asset.env.isBrowser() ||
    options.mode !== 'development'
  ) {
    return true;
  } else {
    let pkg = await asset.getPackage();
    return !(pkg && pkg.dependencies && pkg.dependencies['react']);
  }
}

export default new Transformer({
  async transform({asset, options}) {
    if (!(await shouldExclude(asset, options))) {
      let reactRefreshBabelPlugin = (
        await options.packageManager.resolve('react-refresh/babel', __filename)
      ).resolved;

      asset.meta.babelPlugins = asset.meta.babelPlugins || [];
      invariant(Array.isArray(asset.meta.babelPlugins));
      asset.meta.babelPlugins.push([
        reactRefreshBabelPlugin,
        {skipEnvCheck: true},
      ]);
    }
    return [asset];
  },
});
