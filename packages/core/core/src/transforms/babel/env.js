const presetEnv = require('@babel/preset-env');
const getTargetEngines = require('../../utils/getTargetEngines');

/**
 * Generates a @babel/preset-env config for an asset.
 * This is done by finding the source module's target engines, and the app's
 * target engines, and doing a diff to include only the necessary plugins.
 */
async function getEnvConfig(asset, isSourceModule) {
  // Load the target engines for the app and generate a @babel/preset-env config
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

  return {
    internal: true,
    babelVersion: 7,
    config: {
      plugins: targetEnv
    }
  };
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
    {assertVersion: () => true},
    {
      targets,
      modules: false,
      useBuiltIns: useBuiltIns ? 'entry' : false,
      shippedProposals: true
    }
  ).plugins;

  envCache.set(key, plugins);
  return plugins;
}

module.exports = getEnvConfig;
