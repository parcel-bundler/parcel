// @flow
import type {MutableAsset} from '@parcel/types';
import getBabelRc from './babelrc';
import getEnvConfig from './env';
import getJSXConfig from './jsx';
import getFlowConfig from './flow';
import path from 'path';
import * as fs from '@parcel/fs';

const TYPESCRIPT_EXTNAME_RE = /^\.tsx?/;
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

export default async function getBabelConfig(asset: MutableAsset) {
  // Consider the module source code rather than precompiled if the resolver
  // used the `source` field, or it is not in node_modules.
  let pkg = await asset.getPackage();
  let isSource =
    !!(
      pkg &&
      pkg.source &&
      (await fs.realpath(asset.filePath)) !== asset.filePath
    ) || !asset.filePath.includes(NODE_MODULES);

  // Try to resolve a .babelrc file. If one is found, consider the module source code.
  let babelrc = await getBabelRc(asset, pkg, isSource);
  isSource = isSource || !!babelrc;

  let result = {};
  mergeConfigs(result, babelrc);

  // Typescript must use the plugin directly (not the typescript preset) and must
  // come before preset env, otherwise proposals and nonstandard syntax is not
  // transformed in time.
  if (path.extname(asset.filePath).match(TYPESCRIPT_EXTNAME_RE)) {
    let hasTypescript =
      babelrc &&
      (hasPlugin(babelrc.config.presets, [
        '@babel/typescript',
        '@babel/preset-typescript'
      ]) ||
        hasPlugin(babelrc.config.plugins, [
          '@babel/transform-typescript',
          '@babel/plugin-transform-typescript'
        ]));

    if (!hasTypescript) {
      mergeConfigs(result, {
        internal: true,
        babelVersion: 7,
        config: {
          plugins: [
            [
              require('@babel/plugin-transform-typescript'),
              {isTSX: path.extname(asset.filePath) === '.tsx'}
            ]
          ]
        }
      });
    }
  } else {
    // Add Flow stripping config if it isn't already specified in the babelrc
    let hasFlow =
      babelrc &&
      hasPlugin(babelrc.config.plugins, [
        'transform-flow-strip-types',
        '@babel/transform-flow-strip-types',
        '@babel/plugin-transform-flow-strip-types'
      ]);

    if (!hasFlow) {
      let flowConfig = await getFlowConfig(asset);
      mergeConfigs(result, flowConfig);
    }
  }

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
    let jsxConfig = await getJSXConfig(asset, pkg, isSource);
    mergeConfigs(result, jsxConfig);
  }

  // Add a generated babel-preset-env config if it is not already specified in the babelrc
  let hasEnv =
    babelrc &&
    hasPlugin(babelrc.config.presets, [
      'env',
      '@babel/env',
      '@babel/preset-env'
    ]);

  if (!hasEnv) {
    let envConfig = await getEnvConfig(asset, isSource);
    mergeConfigs(result, envConfig);
  }

  return result;
}

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
