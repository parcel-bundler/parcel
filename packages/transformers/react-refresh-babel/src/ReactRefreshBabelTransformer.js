// @flow

import {Transformer} from '@parcel/plugin';
import invariant from 'assert';

async function shouldExclude(config, options) {
  if (
    !config.isSource ||
    !options.hmrOptions ||
    !config.env.isBrowser() ||
    options.mode !== 'development'
  ) {
    return true;
  } else {
    let pkg = await config.getPackage();
    let usesReact = pkg?.dependencies?.react || pkg?.peerDependencies?.react;
    return !usesReact;
  }
}

export default (new Transformer({
  async loadConfig({config, options}) {
    config.setResult(await shouldExclude(config, options));
  },
  transform({asset, config}) {
    if (!config) {
      asset.meta.babelPlugins = asset.meta.babelPlugins || [];
      invariant(Array.isArray(asset.meta.babelPlugins));
      asset.meta.babelPlugins.push([
        require.resolve('react-refresh/babel'),
        {skipEnvCheck: true},
      ]);
    }
    return [asset];
  },
}): Transformer);
