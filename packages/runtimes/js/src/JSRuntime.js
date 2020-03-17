// @flow strict-local

import type {
  Bundle,
  BundleGraph,
  Dependency,
  RuntimeAsset,
} from '@parcel/types';

import assert from 'assert';
import {Runtime} from '@parcel/plugin';
import {relativeBundlePath} from '@parcel/utils';
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

    // Determine if we need to add a dynamic import() polyfill, or if all target browsers support it natively.
    let needsDynamicImportPolyfill = false;
    if (bundle.env.isBrowser() && bundle.env.outputFormat === 'esmodule') {
      needsDynamicImportPolyfill = !bundle.env.matchesEngines(
        DYNAMIC_IMPORT_BROWSERS,
      );
    }

    let assets = [];
    for (let dependency of bundleGraph.getExternalDependencies(bundle)) {
      let bundleGroup = bundleGraph.resolveExternalDependency(dependency);
      if (bundleGroup == null) {
        if (dependency.isURL) {
          // If a URL dependency was not able to be resolved, add a runtime that
          // exports the original moduleSpecifier.
          assets.push({
            filePath: __filename,
            code: `module.exports = ${JSON.stringify(
              dependency.moduleSpecifier,
            )}`,
            dependency,
          });
        }
        continue;
      }

      let bundlesInGroup = bundleGraph.getBundlesInBundleGroup(bundleGroup);

      let [firstBundle] = bundlesInGroup;
      if (firstBundle.isInline) {
        assets.push({
          filePath: path.join(__dirname, `/bundles/${firstBundle.id}.js`),
          code: `module.exports = ${JSON.stringify(dependency.id)};`,
          dependency,
        });

        continue;
      }

      // URL dependencies should always resolve to a runtime that exports a url
      if (dependency.isURL) {
        assets.push(getURLRuntime(dependency, bundle, firstBundle));
        continue;
      }

      // Sort so the bundles containing the entry asset appear last
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

      let loaderModules = loaders
        ? externalBundles
            .map(to => {
              let loader = loaders[to.type];
              if (!loader) {
                return;
              }

              let relativePathExpr = getRelativePathExpr(bundle, to);

              // Use esmodule loader if possible
              if (to.type === 'js' && to.env.outputFormat === 'esmodule') {
                if (!needsDynamicImportPolyfill) {
                  return `import("./" + ${relativePathExpr})`;
                }

                loader = IMPORT_POLYFILL;
              } else if (
                to.type === 'js' &&
                to.env.outputFormat === 'commonjs'
              ) {
                return `Promise.resolve(require("./" + ${relativePathExpr}))`;
              }

              return `require(${JSON.stringify(
                loader,
              )})(require('./bundle-url').getBundleURL() + ${relativePathExpr})`;
            })
            .filter(Boolean)
        : [];

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
        assert(externalBundles.length === 1);
        assets.push(getURLRuntime(dependency, bundle, externalBundles[0]));
      }
    }

    if (
      shouldUseRuntimeManifest(bundle) &&
      bundleGraph.getChildBundles(bundle).length > 0 &&
      isNewContext(bundle, bundleGraph)
    ) {
      assets.push({
        filePath: __filename,
        code: getRegisterCode(bundle, bundleGraph),
        isEntry: true,
      });
    }

    return assets;
  },
});

function isNewContext(bundle: Bundle, bundleGraph: BundleGraph): boolean {
  return (
    bundle.isEntry ||
    bundleGraph
      .getParentBundles(bundle)
      .some(
        parent =>
          parent.env.context !== bundle.env.context || parent.type !== 'js',
      )
  );
}

function getURLRuntime(
  dependency: Dependency,
  from: Bundle,
  to: Bundle,
): RuntimeAsset {
  let relativePathExpr = getRelativePathExpr(from, to);

  if (dependency.meta.webworker === true) {
    return {
      filePath: __filename,
      code: `module.exports = require('./get-worker-url')(${relativePathExpr});`,
      dependency,
    };
  }

  return {
    filePath: __filename,
    code: `module.exports = require('./bundle-url').getBundleURL() + ${relativePathExpr}`,
    dependency,
  };
}

function getRegisterCode(
  entryBundle: Bundle,
  bundleGraph: BundleGraph,
): string {
  let idToName = {};
  bundleGraph.traverseBundles((bundle, _, actions) => {
    if (bundle.isInline) {
      return;
    }

    idToName[getPublicBundleId(bundle)] = nullthrows(bundle.name);

    if (bundle !== entryBundle && isNewContext(bundle, bundleGraph)) {
      // New contexts have their own manifests, so there's no need to continue.
      actions.skipChildren();
    }
  }, entryBundle);

  return (
    "require('./bundle-manifest').register(JSON.parse(" +
    JSON.stringify(JSON.stringify(idToName)) +
    '));'
  );
}

function getRelativePathExpr(from: Bundle, to: Bundle): string {
  if (shouldUseRuntimeManifest(from)) {
    return `require('./relative-path')(${JSON.stringify(
      getPublicBundleId(from),
    )}, ${JSON.stringify(getPublicBundleId(to))})`;
  }

  return JSON.stringify(relativeBundlePath(from, to, {leadingDotSlash: false}));
}

function shouldUseRuntimeManifest(bundle: Bundle): boolean {
  let env = bundle.env;
  return !env.isLibrary && env.outputFormat === 'global' && env.isBrowser();
}

function getPublicBundleId(bundle: Bundle): string {
  return bundle.id.slice(-16);
}
