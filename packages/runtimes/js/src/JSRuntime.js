// @flow strict-local

import {Runtime} from '@parcel/plugin';
import {urlJoin, relativeBundlePath} from '@parcel/utils';
import path from 'path';
import nullthrows from 'nullthrows';

// List of browsers that support dynamic import natively
// https://caniuse.com/#feat=es6-module-dynamic-import
const DYNAMIC_IMPORT_BROWSERS = {
  edge: '76',
  firefox: '67',
  chrome: '63',
  safari: '11.1',
  opera: '50',
};

const IMPORT_POLYFILL = './loaders/browser/import-polyfill';
const LOADERS = {
  browser: {
    css: './loaders/browser/css-loader',
    html: './loaders/browser/html-loader',
    js: './loaders/browser/js-loader',
    wasm: './loaders/browser/wasm-loader',
  },
  node: {
    css: './loaders/node/css-loader',
    html: './loaders/node/html-loader',
    js: './loaders/node/js-loader',
    wasm: './loaders/node/wasm-loader',
  },
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
    if (bundle.env.isBrowser() && bundle.env.outputFormat === 'esmodule') {
      needsDynamicImportPolyfill = !bundle.env.matchesEngines(
        DYNAMIC_IMPORT_BROWSERS,
      );
    }

    for (let {
      bundleGroup,
      dependency,
    } of bundleGraph.getBundleGroupsReferencedByBundle(bundle)) {
      // Ignore deps with native loaders, e.g. workers.
      if (dependency.isURL) {
        continue;
      }

      // Sort so the bundles containing the entry asset appear last
      let bundlesInGroup = bundleGraph.getBundlesInBundleGroup(bundleGroup);

      let [firstBundle] = bundlesInGroup;
      if (firstBundle.isInline) {
        assets.push({
          filePath: path.join(__dirname, `/bundles/${firstBundle.id}.js`),
          code: `module.exports = "${dependency.id}";`,
          dependency,
        });

        continue;
      }

      let externalBundles = bundlesInGroup
        .filter(bundle => !bundle.isInline)
        .sort(bundle =>
          bundle
            .getEntryAssets()
            .map(asset => asset.id)
            .includes(bundleGroup.entryAssetId)
            ? 1
            : -1,
        );

      // CommonJS is a synchronous module system, so there is no need to load bundles in parallel.
      // Importing of the other bundles will be handled by the bundle group entry.
      // Do the same thing in library mode for ES modules, as we are building for another bundler
      // and the imports for sibling bundles will be in the target bundle.
      if (bundle.env.outputFormat === 'commonjs' || bundle.env.isLibrary) {
        externalBundles = externalBundles.slice(-1);
      }

      let loaderModules = externalBundles
        .map(b => {
          let loader = loaders[b.type];
          if (!loader) {
            return;
          }

          // Use esmodule loader if possible
          if (b.type === 'js' && b.env.outputFormat === 'esmodule') {
            if (!needsDynamicImportPolyfill) {
              return `import('' + '${relativeBundlePath(bundle, b)}')`;
            }

            loader = IMPORT_POLYFILL;
          } else if (b.type === 'js' && b.env.outputFormat === 'commonjs') {
            return `Promise.resolve(require('' + '${relativeBundlePath(
              bundle,
              b,
            )}'))`;
          }

          let url = urlJoin(nullthrows(b.target.publicUrl), nullthrows(b.name));

          return `require(${JSON.stringify(loader)})('${url}')`;
        })
        .filter(Boolean);

      if (loaderModules.length > 0) {
        let loaders = loaderModules.join(', ');
        if (
          loaderModules.length > 1 &&
          (bundle.env.outputFormat === 'global' ||
            !externalBundles.every(b => b.type === 'js'))
        ) {
          loaders = `Promise.all([${loaders}])`;
          if (bundle.env.outputFormat !== 'global') {
            loaders += `.then(r => r[r.length - 1])`;
          }
        }

        if (bundle.env.outputFormat === 'global') {
          loaders += `.then(() => parcelRequire('${bundleGroup.entryAssetId}'))`;
        }

        assets.push({
          filePath: __filename,
          code: `module.exports = ${loaders};`,
          dependency,
        });
      } else {
        for (let bundle of externalBundles) {
          let filePath = nullthrows(bundle.getMainEntry()).filePath;
          if (bundle.target == null) {
            throw new Error('JSRuntime: Bundle did not have a target');
          }

          if (bundle.target.publicUrl == null) {
            throw new Error(
              'JSRuntime: Bundle target did not have a publicUrl',
            );
          }

          assets.push({
            filePath: filePath + '.js',
            code: `module.exports = '${urlJoin(
              bundle.target.publicUrl,
              nullthrows(bundle.name),
            )}'`,
            dependency,
          });
        }
      }
    }

    return assets;
  },
});
