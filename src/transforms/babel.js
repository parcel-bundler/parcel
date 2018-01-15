const babel = require('babel-core');
const presetEnv = require('babel-preset-env');
const getTargetEngines = require('../utils/getTargetEngines');

module.exports = async function(asset) {
  let config = await getConfig(asset);
  if (!config) {
    return;
  }

  await asset.parseIfNeeded();

  config.code = false;
  config.filename = asset.name;
  config.babelrc = false;

  let res = babel.transformFromAst(asset.ast, asset.contents, config);
  if (!res.ignored) {
    asset.ast = res.ast;
    asset.isAstDirty = true;
  }
};

async function getConfig(asset) {
  // If asset is marked as an ES6 modules, this is a second pass after dependencies are extracted.
  // Just compile modules to CommonJS.
  if (asset.isES6Module) {
    return {
      plugins: [require('babel-plugin-transform-es2015-modules-commonjs')]
    };
  }

  if (asset.babelConfig) {
    return asset.babelConfig;
  }

  // Attempt to generate a config
  let config = await getEnvConfig(asset);

  // If this is the app module, and there is a .babelrc, merge it into the config.
  // Don't load .babelrc for node_modules. https://github.com/parcel-bundler/parcel/issues/13.
  if (!asset.name.includes('/node_modules/')) {
    let babelrc =
      (asset.package && asset.package.babel) ||
      (await asset.getConfig(['.babelrc', '.babelrc.js']));
    if (babelrc) {
      config = Object.assign({}, babelrc, {
        plugins: (babelrc.plugins || []).concat(config ? config.plugins : [])
      });
    }
  }

  return config;
}

module.exports.getConfig = getConfig;

async function getEnvConfig(asset) {
  // Load supported source engines (node and browser versions) for source module and target app,
  // and generate a babel-preset-env config for each.
  let sourceEngines = await getTargetEngines(asset);
  let targetEngines = await getTargetEngines(asset, asset.options.mainFile);
  let sourceEnv = await getEnvPlugins(sourceEngines);
  let targetEnv = await getEnvPlugins(targetEngines);

  if (!sourceEnv || !targetEnv) {
    return;
  }

  // Do a diff of the returned plugins. We only need to process the remaining plugins to get to the app target.
  // If this is the app module, the source and target will be the same, so just compile everything.
  if (asset.name.includes('/node_modules/')) {
    let sourcePlugins = new Set(sourceEnv.map(p => p[0]));
    targetEnv = targetEnv.filter(plugin => {
      return !sourcePlugins.has(plugin[0]);
    });
  }

  if (targetEnv.length === 0) {
    return null;
  }

  return {plugins: targetEnv};
}

const envCache = new Map();

async function getEnvPlugins(targets) {
  if (!targets) {
    return null;
  }

  let key = JSON.stringify(targets);
  if (envCache.has(key)) {
    return envCache.get(key);
  }

  let plugins = presetEnv.default({}, {targets, modules: false}).plugins;
  envCache.set(key, plugins);
  return plugins;
}
