// @flow strict-local

import {Runtime} from '@parcel/plugin';
import {urlJoin} from '@parcel/utils';
import nullthrows from 'nullthrows';
import path from 'path';

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
  async apply({bundle, bundleGraph}) {
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
    bundle.traverseAssets(asset => {
      let dependencies = bundle.getDependencies(asset);
      for (let dependency of dependencies) {
        let resolvedAsset = bundle.getDependencyResolution(dependency);
        if (resolvedAsset && resolvedAsset.type !== 'js') {
          // "raw asset"-style fallback
          // if this dependency doesn't resolve to a js asset, it's an asset reference
          // of a different type. If there isn't a loader for it, replace it with
          // a js asset that exports a relative url (using publicURL) to the bundle
          // it's located in.
          let assetBundle = bundleGraph.findBundlesWithAsset(resolvedAsset)[0];
          let hasLoader = loaders && loaders[assetBundle.type];
          if (!hasLoader) {
            if (assetBundle.target == null) {
              throw new Error('JSRuntime: Bundle did not have a target');
            }
            if (assetBundle.target.publicUrl == null) {
              throw new Error(
                'JSRuntime: Bundle target did not have a publicUrl'
              );
            }

            assets.push({
              filePath: resolvedAsset.filePath + '.js',
              code: `module.exports = '${urlJoin(
                assetBundle.target.publicUrl,
                nullthrows(assetBundle.name)
              )}'`,
              dependency
            });
          }
        }
      }
    });

    if (!loaders) {
      return assets;
    }

    for (let bundleGroup of bundleGraph.getBundleGroupsReferencedByBundle(
      bundle
    )) {
      // Ignore deps with native loaders, e.g. workers.
      if (bundleGroup.dependency.isURL) {
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
      let loaderModules = bundles
        .map(b => {
          let loader = loaders[b.type];
          if (!loader) {
            return;
          }

          return `[require(${JSON.stringify(loader)}), ${JSON.stringify(
            // $FlowFixMe - bundle.filePath already exists here
            path.relative(path.dirname(bundle.filePath), b.filePath)
          )}]`;
        })
        .filter(Boolean);

      if (loaderModules.length > 0) {
        assets.push({
          filePath: __filename,
          code: `module.exports = require('./bundle-loader')([${loaderModules.join(
            ', '
          )}, ${JSON.stringify(bundleGroup.entryAssetId)}]);`,
          dependency: bundleGroup.dependency
        });
      }
    }

    return assets;
  }
});
