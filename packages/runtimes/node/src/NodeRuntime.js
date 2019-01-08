// @flow
import {Runtime} from '@parcel/plugin';
import path from 'path';

const LOADERS = {
  css: './loaders/css-loader',
  html: './loaders/html-loader',
  js: './loaders/js-loader',
  wasm: './loaders/wasm-loader'
};

export default new Runtime({
  async apply(bundle) {
    // Dependency ids in code replaced with referenced bundle names
    // Loader runtime added for bundle groups that don't have a native loader (e.g. HTML/CSS/Worker - isURL?),
    // and which are not loaded by a parent bundle.
    // Loaders also added for modules that were moved to a separate bundle because they are a different type
    // (e.g. WASM, HTML). These should be preloaded prior to the bundle being executed. Replace the entry asset(s)
    // with the preload module.

    if (bundle.type !== 'js') {
      return;
    }

    let bundleGroups = Array.from(bundle.assetGraph.nodes.values()).filter(
      n => n.type === 'bundle_group'
    );
    for (let bundleGroup of bundleGroups) {
      let bundles = bundle.assetGraph
        .getNodesConnectedFrom(bundleGroup)
        .map(node => node.value);

      let loaderModules = bundles.map(b => {
        let loader = LOADERS[b.type];
        if (!loader) {
          throw new Error('Could not find a loader for ');
        }

        return `[require(${JSON.stringify(loader)}), ${JSON.stringify(
          path.relative(path.dirname(bundle.filePath), b.filePath)
        )}]`;
      });

      await bundle.assetGraph.addRuntimeAsset(bundleGroup, {
        filePath: __filename,
        env: bundle.env,
        code: `module.exports = require('./bundle-loader')([${loaderModules.join(
          ', '
        )}, ${JSON.stringify(bundleGroup.value.entryAssetId)}]);`
      });
    }
  }
});
