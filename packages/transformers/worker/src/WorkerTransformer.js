// @flow strict-local

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  transform({asset}) {
    asset.setEnvironment({
      engines: asset.env.engines,
      includeNodeModules: asset.env.includeNodeModules,
      outputFormat: asset.env.outputFormat,
      isLibrary: asset.env.isLibrary,
      sourceMap: asset.env.sourceMap,
      minify: asset.env.minify,
      scopeHoist: asset.env.scopeHoist,
      context: 'web-worker',
    });
    asset.isIsolated = true;
    return [asset];
  },
}): Transformer);
