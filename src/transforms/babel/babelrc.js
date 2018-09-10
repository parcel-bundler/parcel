const {buildRootChain} = require('@babel/core/lib/config/config-chain');
const {mergeOptions} = require('@babel/core/lib/config/util');

async function getBabelConfig(asset, isSource) {
  let config = await getBabelRc(asset, isSource);
  if (!config) {
    return null;
  }
  
  return {
    babelVersion: getBabelVersion(config),
    config
  };
}

module.exports = getBabelConfig;

/**
 * Finds a .babelrc for an asset. By default, .babelrc files inside node_modules are not used.
 * However, there are some exceptions:
 *   - if `browserify.transforms` includes "babelify" in package.json (for legacy module compat)
 *   - the `source` field in package.json is used by the resolver
 */
async function getBabelRc(asset, isSource) {
  // Support legacy browserify packages
  let pkg = await asset.getPackage();
  let browserify = pkg && pkg.browserify;
  if (browserify && Array.isArray(browserify.transform)) {
    // Look for babelify in the browserify transform list
    let babelify = browserify.transform.find(
      t => (Array.isArray(t) ? t[0] : t) === 'babelify'
    );

    // If specified as an array, override the config with the one specified
    if (Array.isArray(babelify) && babelify[1]) {
      return babelify[1];
    }

    // Otherwise, return the .babelrc if babelify was found
    return babelify ? await findBabelRc(asset) : null;
  }

  // If this asset is not in node_modules, always use the .babelrc
  if (isSource) {
    return await findBabelRc(asset);
  }

  // Otherwise, don't load .babelrc for node_modules.
  // See https://github.com/parcel-bundler/parcel/issues/13.
  return null;
}

async function findBabelRc(asset) {
  // TODO: support babelignore, etc.
  return await asset.getConfig(['.babelrc', '.babelrc.js'], {
    packageKey: 'babel'
  });
}

function getBabelVersion(babelrc) {
  if (!babelrc.presets && !babelrc.presets) {
    return 7;
  }

  if (
    (babelrc.presets && hasBabel7Plugin(babelrc.presets)) ||
    (babelrc.plugins && hasBabel7Plugin(babelrc.plugins))
  ) {
    return 7;
  }

  return 6;
}

function hasBabel7Plugin(plugins) {
  return plugins.some(plugin => 
    getPluginName(plugin).startsWith('@babel/')
  );
}

function getPluginName(p) {
  return Array.isArray(p) ? p[0] : p;
}
