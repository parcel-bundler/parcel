// @flow strict-local

import path from 'path';
import {Runtime} from '@parcel/plugin';

const LOADERS = {
  browser: {
    css: './loaders/browser/css-loader',
    html: './loaders/browser/html-loader',
    js: './loaders/browser/js-loader',
    wasm: './loaders/browser/wasm-loader'
  },
  node: {
    css: './loaders/node/css-loader',
    html: './loaders/node/html-loader',
    js: './loaders/node/js-loader',
    wasm: './loaders/node/wasm-loader'
  }
};

export default new Runtime({
  async apply(bundle, bundleGraph) {
    // Dependency ids in code replaced with referenced bundle names
    // Loader runtime added for bundle groups that don't have a native loader (e.g. HTML/CSS/Worker - isURL?),
    // and which are not loaded by a parent bundle.
    // Loaders also added for modules that were moved to a separate bundle because they are a different type
    // (e.g. WASM, HTML). These should be preloaded prior to the bundle being executed. Replace the entry asset(s)
    // with the preload module.

    if (bundle.type !== 'js') {
      return;
    }

    // $FlowFixMe - ignore unknown properties?
    let loaders = LOADERS[bundle.env.context];
    if (!loaders) {
      return;
    }

    let assets = [];
    for (let bundleGroup of bundleGraph.getBundleGroupsReferencedByBundle(
      bundle
    )) {
      // Ignore deps with native loaders, e.g. workers.
      if (bundleGroup.dependency.isURL) {
        continue;
      }

      let bundles = bundleGraph.getBundlesInBundleGroup(bundleGroup);
      let loaderModules = bundles.map(b => {
        let loader = loaders[b.type];
        if (!loader) {
          throw new Error('Could not find a loader for bundle type ' + b.type);
        }

        return `[require(${JSON.stringify(loader)}), ${JSON.stringify(
          // $FlowFixMe - bundle.filePath already exists here
          path.relative(path.dirname(bundle.filePath), b.filePath)
        )}]`;
      });

      assets.push({
        filePath: __filename,
        code: `module.exports = require('./bundle-loader')([${loaderModules.join(
          ', '
        )}, ${JSON.stringify(bundleGroup.entryAssetId)}]);`,
        bundleGroup
      });
    }

    return assets;
  }
});
