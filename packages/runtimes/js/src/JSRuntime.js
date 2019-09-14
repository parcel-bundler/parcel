// @flow strict-local

import {Runtime} from '@parcel/plugin';
import {urlJoin} from '@parcel/utils';
import nullthrows from 'nullthrows';
import path from 'path';

const MODULE_LOADER = './loaders/esmodule-loader';
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
  apply({bundle, bundleGraph}) {
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

    let assets = [];
    if (!loaders) {
      return assets;
    }

    for (let {
      bundleGroup,
      dependency
    } of bundleGraph.getBundleGroupsReferencedByBundle(bundle)) {
      // Ignore deps with native loaders, e.g. workers.
      if (dependency.isURL) {
        continue;
      }

      // Sort so the bundles containing the entry asset appear last
      let bundles = bundleGraph
        .getBundlesInBundleGroup(bundleGroup)
        .sort(bundle =>
          bundle
            .getEntryAssets()
            .map(asset => asset.id)
            .includes(bundleGroup.entryAssetId)
            ? 1
            : -1
        );

      // Optimization if we're only loading one esmodule bundle.
      // Just use native `import()` in that case without bringing in the whole loader runtime.
      if (
        bundle.env.isModule &&
        bundles.length === 1 &&
        bundles[0].type === 'js'
      ) {
        assets.push({
          filePath: __filename,
          // String concatenation instead of literal to stop JSTransformer from
          // trying to process this import() call.
          code: `module.exports = import('' + '${urlJoin(
            nullthrows(bundles[0].target.publicUrl),
            nullthrows(bundles[0].name)
          )}');`,
          dependency
        });
        continue;
      }

      let loaderModules = bundles
        .map(b => {
          let loader = loaders[b.type];
          if (!loader) {
            return;
          }

          // Use esmodule loader if possible
          if (b.type === 'js' && b.env.isModule) {
            loader = MODULE_LOADER;
          }

          return `[require(${JSON.stringify(loader)}), ${JSON.stringify(
            path.relative(path.dirname(bundle.filePath), nullthrows(b.filePath))
          )}]`;
        })
        .filter(Boolean);

      if (loaderModules.length > 0) {
        assets.push({
          filePath: __filename,
          code: `module.exports = require('./bundle-loader')([${loaderModules.join(
            ', '
          )}, ${JSON.stringify(bundleGroup.entryAssetId)}]);`,
          dependency
        });
      } else {
        for (let bundle of bundles) {
          let filePath = nullthrows(bundle.getMainEntry()).filePath;
          if (bundle.target == null) {
            throw new Error('JSRuntime: Bundle did not have a target');
          }

          if (bundle.target.publicUrl == null) {
            throw new Error(
              'JSRuntime: Bundle target did not have a publicUrl'
            );
          }

          assets.push({
            filePath: filePath + '.js',
            code: `module.exports = '${urlJoin(
              bundle.target.publicUrl,
              nullthrows(bundle.name)
            )}'`,
            dependency
          });
        }
      }
    }

    return assets;
  }
});
