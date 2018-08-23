const presetEnv = require('babel-preset-env');
const getTargetEngines = require('../utils/getTargetEngines');
const localRequire = require('../utils/localRequire');
const path = require('path');
const {util: babelUtils} = require('babel-core');
const fs = require('../utils/fs');

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
const ENV_PLUGINS = require('babel-preset-env/data/plugins');
const ENV_PRESETS = {
  es2015: true,
  es2016: true,
  es2017: true,
  latest: true,
  env: true
};

const JSX_EXTENSIONS = {
  '.jsx': true,
  '.tsx': true
};

const JSX_PRAGMA = {
  react: 'React.createElement',
  preact: 'h',
  nervjs: 'Nerv.createElement',
  hyperapp: 'h'
};

async function babelTransform(asset) {
  let config = await getConfig(asset);
  if (!config) {
    return;
  }

  await asset.parseIfNeeded();

  // If this is an internally generated config, use our internal babel-core,
  // otherwise require a local version from the package we're compiling.
  let babel = config.internal
    ? require('babel-core')
    : await localRequire('babel-core', asset.name);

  // TODO: support other versions of babel
  if (parseInt(babel.version, 10) !== 6) {
    throw new Error(`Unsupported babel version: ${babel.version}`);
  }

  let res = babel.transformFromAst(asset.ast, asset.contents, config);
  if (!res.ignored) {
    asset.ast = res.ast;
    asset.isAstDirty = true;
  }
}

module.exports = babelTransform;

async function getConfig(asset) {
  let config = await getBabelConfig(asset);
  if (config) {
    config.code = false;
    config.filename = asset.name;
    config.babelrc = false;

    // Hide the internal property from babel
    let internal = config.internal;
    delete config.internal;
    Object.defineProperty(config, 'internal', {
      value: internal,
      configurable: true
    });
  }

  return config;
}

babelTransform.getConfig = getConfig;

async function getBabelConfig(asset) {
  // If asset is marked as an ES6 modules, this is a second pass after dependencies are extracted.
  // Just compile modules to CommonJS.
  if (asset.isES6Module) {
    return {
      internal: true,
      plugins: [require('babel-plugin-transform-es2015-modules-commonjs')]
    };
  }

  if (asset.babelConfig) {
    return asset.babelConfig;
  }

  // Consider the module source code rather than precompiled if the resolver
  // used the `source` field, or it is not in node_modules.
  let pkg = await asset.getPackage();
  let isSource =
    !!(pkg && pkg.source && (await fs.realpath(asset.name)) !== asset.name) ||
    !asset.name.includes(NODE_MODULES);

  // Try to resolve a .babelrc file. If one is found, consider the module source code.
  let babelrc = await getBabelRc(asset, isSource);
  isSource = isSource || !!babelrc;

  let envConfig = await getEnvConfig(asset, isSource);
  let jsxConfig = await getJSXConfig(asset, isSource);
  let flowConfig = getFlowConfig(asset, isSource);

  // Merge the babel-preset-env config and the babelrc if needed
  if (babelrc && !shouldIgnoreBabelrc(asset.name, babelrc)) {
    if (envConfig) {
      // Filter out presets that are already applied by babel-preset-env
      if (Array.isArray(babelrc.presets)) {
        babelrc.presets = babelrc.presets.filter(preset => {
          return !ENV_PRESETS[getPluginName(preset)];
        });
      }

      // Filter out plugins that are already applied by babel-preset-env
      if (Array.isArray(babelrc.plugins)) {
        babelrc.plugins = babelrc.plugins.filter(plugin => {
          return !ENV_PLUGINS[getPluginName(plugin)];
        });
      }

      // Add plugins generated by babel-preset-env to get to the app's target engines.
      mergeConfigs(babelrc, envConfig);
    }

    // Add JSX config if it isn't already specified in the babelrc
    let hasReact =
      hasPlugin(babelrc.presets, 'react') ||
      hasPlugin(babelrc.plugins, 'transform-react-jsx');

    if (!hasReact) {
      mergeConfigs(babelrc, jsxConfig);
    }

    return babelrc;
  }

  // If there is a babel-preset-env config, and it isn't empty use that
  if (envConfig && (envConfig.plugins.length > 0 || jsxConfig)) {
    mergeConfigs(envConfig, jsxConfig);
    return envConfig;
  }

  // If there is a JSX config, return that
  if (jsxConfig) {
    return jsxConfig;
  }

  // If there is a Flow config, return that
  if (flowConfig) {
    return flowConfig;
  }

  // Otherwise, don't run babel at all
  return null;
}

function mergeConfigs(a, b) {
  if (b) {
    a.presets = (a.presets || []).concat(b.presets || []);
    a.plugins = (a.plugins || []).concat(b.plugins || []);
  }

  return a;
}

function hasPlugin(arr, plugin) {
  return Array.isArray(arr) && arr.some(p => getPluginName(p) === plugin);
}

function getPluginName(p) {
  return Array.isArray(p) ? p[0] : p;
}

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
  return await asset.getConfig(['.babelrc', '.babelrc.js'], {
    packageKey: 'babel'
  });
}

function shouldIgnoreBabelrc(filename, babelrc) {
  // Determine if we should ignore this babelrc file. We do this here instead of
  // letting babel-core handle it because this config might be merged with our
  // autogenerated one later which shouldn't be ignored.
  let ignore = babelUtils.arrayify(babelrc.ignore, babelUtils.regexify);
  let only =
    babelrc.only && babelUtils.arrayify(babelrc.only, babelUtils.regexify);
  return babelUtils.shouldIgnore(filename, ignore, only);
}

/**
 * Generates a babel-preset-env config for an asset.
 * This is done by finding the source module's target engines, and the app's
 * target engines, and doing a diff to include only the necessary plugins.
 */
async function getEnvConfig(asset, isSourceModule) {
  // Load the target engines for the app and generate a babel-preset-env config
  let targetEngines = await getTargetEngines(asset, true);
  let targetEnv = await getEnvPlugins(targetEngines, true);
  if (!targetEnv) {
    return null;
  }

  // If this is the app module, the source and target will be the same, so just compile everything.
  // Otherwise, load the source engines and generate a babel-present-env config.
  if (!isSourceModule) {
    let sourceEngines = await getTargetEngines(asset, false);
    let sourceEnv = (await getEnvPlugins(sourceEngines, false)) || targetEnv;

    // Do a diff of the returned plugins. We only need to process the remaining plugins to get to the app target.
    let sourcePlugins = new Set(sourceEnv.map(p => p[0]));
    targetEnv = targetEnv.filter(plugin => {
      return !sourcePlugins.has(plugin[0]);
    });
  }

  return {plugins: targetEnv, internal: true};
}

const envCache = new Map();

async function getEnvPlugins(targets, useBuiltIns = false) {
  if (!targets) {
    return null;
  }

  let key = JSON.stringify(targets);
  if (envCache.has(key)) {
    return envCache.get(key);
  }

  let plugins = presetEnv.default(
    {},
    {targets, modules: false, useBuiltIns: useBuiltIns ? 'entry' : false}
  ).plugins;
  envCache.set(key, plugins);
  return plugins;
}

/**
 * Generates a babel config for JSX. Attempts to detect react or react-like libraries
 * and changes the pragma accordingly.
 */
async function getJSXConfig(asset, isSourceModule) {
  // Don't enable JSX in node_modules
  if (!isSourceModule) {
    return null;
  }

  let pkg = await asset.getPackage();

  // Find a dependency that we can map to a JSX pragma
  let pragma = null;
  for (let dep in JSX_PRAGMA) {
    if (
      pkg &&
      ((pkg.dependencies && pkg.dependencies[dep]) ||
        (pkg.devDependencies && pkg.devDependencies[dep]))
    ) {
      pragma = JSX_PRAGMA[dep];
      break;
    }
  }

  if (pragma || JSX_EXTENSIONS[path.extname(asset.name)]) {
    return {
      plugins: [[require('babel-plugin-transform-react-jsx'), {pragma}]],
      internal: true
    };
  }
}

/**
 * Generates a babel config for stripping away Flow types.
 */
function getFlowConfig(asset) {
  if (/^(\/{2}|\/\*+) *@flow/.test(asset.contents.substring(0, 20))) {
    return {
      plugins: [[require('babel-plugin-transform-flow-strip-types')]],
      internal: true
    };
  }

  return null;
}
