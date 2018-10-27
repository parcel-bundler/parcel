const getBabelRc = require('./babelrc');
const getEnvConfig = require('./env');
const getJSXConfig = require('./jsx');
const getFlowConfig = require('./flow');
const path = require('path');
const fs = require('@parcel/fs');

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
const ENV_PLUGINS = require('@babel/preset-env/data/plugins');
const ENV_PRESETS = {
  es2015: true,
  es2016: true,
  es2017: true,
  latest: true,
  env: true,
  '@babel/preset-env': true,
  '@babel/env': true
};

async function getBabelConfig(asset) {
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

  if (babelrc && envConfig) {
    // Filter out presets that are already applied by @babel/preset-env
    if (Array.isArray(babelrc.config.presets)) {
      babelrc.config.presets = babelrc.config.presets.filter(preset => {
        return !ENV_PRESETS[getPluginName(preset)];
      });
    }

    // Filter out plugins that are already applied by @babel/preset-env
    if (Array.isArray(babelrc.config.plugins)) {
      babelrc.config.plugins = babelrc.config.plugins.filter(plugin => {
        return !ENV_PLUGINS[getPluginName(plugin)];
      });
    }
  }

  let result = {};
  mergeConfigs(result, babelrc);
  mergeConfigs(result, envConfig);

  // Add JSX config if it isn't already specified in the babelrc
  let hasReact =
    babelrc &&
    (hasPlugin(babelrc.config.presets, [
      'react',
      '@babel/react',
      '@babel/preset-react'
    ]) ||
      hasPlugin(babelrc.config.plugins, [
        'transform-react-jsx',
        '@babel/transform-react-jsx',
        '@babel/plugin-transform-react-jsx'
      ]));

  if (!hasReact) {
    mergeConfigs(result, jsxConfig);
  }

  // Add Flow stripping config if it isn't already specified in the babelrc
  let hasFlow =
    babelrc &&
    hasPlugin(babelrc.config.plugins, [
      'transform-flow-strip-types',
      '@babel/transform-flow-strip-types',
      '@babel/plugin-transform-flow-strip-types'
    ]);

  if (!hasFlow) {
    mergeConfigs(result, flowConfig);
  }

  return result;
}

module.exports = getBabelConfig;

function mergeConfigs(result, config) {
  if (
    !config ||
    ((!config.config.presets || config.config.presets.length === 0) &&
      (!config.config.plugins || config.config.plugins.length === 0))
  ) {
    return;
  }

  let merged = result[config.babelVersion];
  if (merged) {
    merged.config.presets = (merged.config.presets || []).concat(
      config.config.presets || []
    );
    merged.config.plugins = (merged.config.plugins || []).concat(
      config.config.plugins || []
    );
  } else {
    result[config.babelVersion] = config;
  }
}

function hasPlugin(arr, plugins) {
  return (
    Array.isArray(arr) && arr.some(p => plugins.includes(getPluginName(p)))
  );
}

function getPluginName(p) {
  return Array.isArray(p) ? p[0] : p;
}
