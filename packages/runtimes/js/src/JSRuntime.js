// @flow strict-local

import {Runtime} from '@parcel/plugin';
import {urlJoin} from '@parcel/utils';
import nullthrows from 'nullthrows';
import path from 'path';
// $FlowFixMe
import browserslist from 'browserslist';

// List of browsers to exclude when the esmodule target is specified.
// Based on https://caniuse.com/#feat=es6-module
const ESMODULE_BROWSERS = [
  'not ie <= 11',
  'not edge < 16',
  'not firefox < 60',
  'not chrome < 61',
  'not safari < 11',
  'not opera < 48',
  'not ios < 11',
  'not op_mini all',
  'not android < 76',
  'not blackberry > 0',
  'not op_mob > 0',
  'not and_chr < 76',
  'not and_ff < 68',
  'not ie_mob > 0',
  'not and_uc > 0',
  'not samsung < 8.2',
  'not and_qq > 0',
  'not baidu > 0',
  'not kaios > 0'
];

// https://caniuse.com/#feat=es6-module-dynamic-import
const DYNAMIC_IMPORT_BROWSERS = [
  'not edge < 76',
  'not firefox < 67',
  'not chrome < 63',
  'not safari < 11.1',
  'not opera < 50'
];

const MODULE_LOADER = './loaders/esmodule-loader';
const IMPORT_POLYFILL = './loaders/browser/import-polyfill';
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

    // Determine if we need to add a dynamic import() polyfill, or if all target browsers support it natively.
    let needsDynamicImportPolyfill = false;
    if (bundle.env.isBrowser() && bundle.env.isModule) {
      let targetBrowsers = bundle.env.engines.browsers;
      let browsers =
        targetBrowsers != null && !Array.isArray(targetBrowsers)
          ? [targetBrowsers]
          : targetBrowsers || [];
      let esmoduleBrowsers = browserslist([...browsers, ...ESMODULE_BROWSERS]);
      let dynamicImportBrowsers = browserslist([
        ...browsers,
        ...ESMODULE_BROWSERS,
        ...DYNAMIC_IMPORT_BROWSERS
      ]);
      needsDynamicImportPolyfill =
        esmoduleBrowsers.length !== dynamicImportBrowsers.length;
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

      // Optimization if we're only loading esmodule bundles.
      // Just use native `import()` in that case without bringing in the whole loader runtime.
      if (
        bundle.env.isModule &&
        bundles.every(b => b.type === 'js' && b.env.isModule)
      ) {
        let _import = needsDynamicImportPolyfill
          ? `require('${IMPORT_POLYFILL}')`
          : 'import';
        let imports = bundles.map(
          b =>
            // String concatenation instead of literal to stop JSTransformer from
            // trying to process this import() call.
            `${_import}('' + '${urlJoin(
              nullthrows(b.target.publicUrl),
              nullthrows(b.name)
            )}')`
        );
        assets.push({
          filePath: __filename,
          code: `module.exports = ${imports.join(', ')};`,
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
            loader = needsDynamicImportPolyfill
              ? IMPORT_POLYFILL
              : MODULE_LOADER;
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
