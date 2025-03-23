// @flow

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  transform({asset}) {
    // ReactStaticPackager doesn't support scope hoisting.
    if (asset.env.shouldScopeHoist) {
      asset.setEnvironment({
        shouldScopeHoist: false,
        context: 'react-server',
        sourceType: asset.env.sourceType,
        outputFormat: asset.env.outputFormat,
        engines: asset.env.engines,
        includeNodeModules: asset.env.includeNodeModules,
        isLibrary: asset.env.isLibrary,
        sourceMap: asset.env.sourceMap,
        shouldOptimize: asset.env.shouldOptimize,
      });
    }

    asset.bundleBehavior = 'isolated';
    asset.meta.bundleExtension = 'html';
    return [asset];
  },
}): Transformer);
