// @flow strict-local

import type {
  Bundle,
  BundleGraph,
  BundleGroup,
  Dependency,
  Environment,
  RuntimeAsset,
} from '@parcel/types';

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

const LOADERS = {
  browser: {
    css: './loaders/browser/css-loader',
    html: './loaders/browser/html-loader',
    js: './loaders/browser/js-loader',
    wasm: './loaders/browser/wasm-loader',
    IMPORT_POLYFILL: './loaders/browser/import-polyfill',
  },
  worker: {
    js: './loaders/worker/js-loader',
    wasm: './loaders/worker/wasm-loader',
    IMPORT_POLYFILL: false,
  },
  node: {
    css: './loaders/node/css-loader',
    html: './loaders/node/html-loader',
    js: './loaders/node/js-loader',
    wasm: './loaders/node/wasm-loader',
    IMPORT_POLYFILL: null,
  },
};
function getLoaders(
  ctx: Environment,
): ?{[string]: string, IMPORT_POLYFILL: null | false | string, ...} {
  if (ctx.isWorker()) return LOADERS.worker;
  if (ctx.isBrowser()) return LOADERS.browser;
  if (ctx.isNode()) return LOADERS.node;
  return null;
}

export default new Runtime({
  apply({bundle, bundleGraph, options}) {
    // Dependency ids in code replaced with referenced bundle names
    // Loader runtime added for bundle groups that don't have a native loader (e.g. HTML/CSS/Worker - isURL?),
    // and which are not loaded by a parent bundle.
    // Loaders also added for modules that were moved to a separate bundle because they are a different type
    // (e.g. WASM, HTML). These should be preloaded prior to the bundle being executed. Replace the entry asset(s)
    // with the preload module.

    if (bundle.type !== 'js') {
      return;
    }

    let asyncDependencies = [];
    let otherDependencies = [];
    bundle.traverse(node => {
      if (node.type !== 'dependency') {
        return;
      }

      let dependency = node.value;
      if (dependency.isAsync && !dependency.isURL) {
        asyncDependencies.push(dependency);
      } else {
        otherDependencies.push(dependency);
      }
    });

    let assets = [];
    for (let dependency of asyncDependencies) {
      let resolved = bundleGraph.resolveExternalDependency(dependency, bundle);
      if (resolved == null) {
        continue;
      }

      if (resolved.type === 'asset') {
        // If this bundle already has the asset this dependency references,
        // return a simple runtime of `Promise.resolve(require("path/to/asset"))`.
        assets.push({
          filePath: path.join(options.projectRoot, 'JSRuntime.js'),
          // Using Promise['resolve'] to prevent Parcel from inferring this is an async dependency.
          // TODO: Find a better way of doing this.
          code: `module.exports = Promise['resolve'](require(${JSON.stringify(
            './' + path.relative(options.projectRoot, resolved.value.filePath),
          )}))`,
          dependency,
        });
      } else {
        assets.push(
          ...getLoaderRuntimes({
            bundle,
            dependency,
            bundleGraph,
            bundleGroup: resolved.value,
          }),
        );
      }
    }

    for (let dependency of otherDependencies) {
      let resolved = bundleGraph.resolveExternalDependency(dependency, bundle);
      if (dependency.isURL && resolved == null) {
        // If a URL dependency was not able to be resolved, add a runtime that
        // exports the original moduleSpecifier.
        assets.push({
          filePath: __filename,
          code: `module.exports = ${JSON.stringify(
            dependency.moduleSpecifier,
          )}`,
          dependency,
        });
        continue;
      }

      if (resolved == null || resolved.type !== 'bundle_group') {
        continue;
      }

      let bundleGroup = resolved.value;
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

      // URL dependency or not, fall back to including a runtime that exports the url
      assets.push(getURLRuntime(dependency, bundle, firstBundle));
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

function getLoaderRuntimes({
  bundle,
  dependency,
  bundleGroup,
  bundleGraph,
}: {|
  bundle: Bundle,
  dependency: Dependency,
  bundleGroup: BundleGroup,
  bundleGraph: BundleGraph,
|}) {
  let assets = [];
  // Sort so the bundles containing the entry asset appear last
  let externalBundles = bundleGraph
    .getBundlesInBundleGroup(bundleGroup)
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

  let loaders = getLoaders(bundle.env);

  // Determine if we need to add a dynamic import() polyfill, or if all target browsers support it natively.
  let needsDynamicImportPolyfill = false;
  if (bundle.env.isBrowser() && bundle.env.outputFormat === 'esmodule') {
    needsDynamicImportPolyfill = !bundle.env.matchesEngines(
      DYNAMIC_IMPORT_BROWSERS,
    );
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

            loader = nullthrows(
              loaders.IMPORT_POLYFILL,
              `No import() polyfill available for context '${bundle.env.context}'`,
            );
          } else if (to.type === 'js' && to.env.outputFormat === 'commonjs') {
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
    } else {
      loaders = `(${loaders})`;
    }

    if (bundle.env.outputFormat === 'global') {
      loaders += `.then(() => parcelRequire('${bundleGroup.entryAssetId}')${
        // In global output with scope hoisting, functions return exports are
        // always returned. Otherwise, the exports are returned.
        bundle.env.scopeHoist ? '()' : ''
      })`;
    }

    assets.push({
      filePath: __filename,
      code: `module.exports = ${loaders};`,
      dependency,
    });
  }

  return assets;
}

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
