// @flow strict-local

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  transform({asset}) {
    asset.bundleBehavior = 'isolated';
    asset.setEnvironment({
      context: 'worklet',
      sourceType: 'module',
      outputFormat: 'esmodule', // Worklets require ESM
      engines: asset.env.engines,
      includeNodeModules: asset.env.includeNodeModules,
      isLibrary: asset.env.isLibrary,
      sourceMap: asset.env.sourceMap,
      shouldOptimize: asset.env.shouldOptimize,
      shouldScopeHoist: asset.env.shouldScopeHoist,
    });
    // Fake symbol to prevent "does not export default" error in symbol propagation.
    asset.symbols.ensure();
    asset.symbols.set('*', 'url');
    return [asset];
  },
}): Transformer);
