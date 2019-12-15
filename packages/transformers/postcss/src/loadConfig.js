// @flow
import type {Config, PluginOptions} from '@parcel/types';

import loadExternalPlugins from './loadPlugins';

const MODULE_BY_NAME_RE = /\.module\./;

async function configHydrator(
  configFile: any,
  config: Config,
  options: PluginOptions,
) {
  if (!configFile) {
    // Use a basic, modules-only PostCSS config if the file opts in by a name
    // like foo.module.css
    if (config.searchPath.match(MODULE_BY_NAME_RE)) {
      return config.setResult({
        raw: configFile,
        hydrated: {
          plugins: await loadExternalPlugins(
            ['postcss-modules'],
            config.searchPath,
            options,
          ),
          from: config.searchPath,
          to: config.searchPath,
        },
      });
    }

    return;
  }

  // Load the custom config...
  let modules;
  let configPlugins = configFile.plugins;
  if (
    configPlugins != null &&
    typeof configPlugins === 'object' &&
    configPlugins['postcss-modules'] != null
  ) {
    modules = configPlugins['postcss-modules'];
    // $FlowFixMe
    delete configPlugins['postcss-modules'];
  }

  if (!modules && configFile.modules) {
    modules = {};
  }

  let plugins = await loadExternalPlugins(
    configPlugins,
    config.searchPath,
    options,
  );

  return config.setResult({
    raw: configFile,
    hydrated: {
      plugins,
      from: config.searchPath,
      to: config.searchPath,
      modules,
    },
  });
}

export async function load(config: Config, options: PluginOptions) {
  let configFile: any = await config.getConfig(
    ['.postcssrc', '.postcssrc.json'],
    {packageKey: 'postcss'},
  );

  if (configFile == null) return;

  if (typeof configFile !== 'object') {
    throw new Error('PostCSS config should be an object.');
  }

  if (
    configFile.plugins == null ||
    typeof configFile.plugins !== 'object' ||
    Object.keys(configFile.plugins) === 0
  ) {
    throw new Error('PostCSS config must have plugins');
  }

  let configFilePlugins = Object.keys(configFile.plugins);
  for (let p of configFilePlugins) {
    if (p.startsWith('.')) {
      throw new Error(
        'Relative plugins are not yet supported as these are not cacheable!',
      );
    }

    config.addDevDependency(p);
  }

  return configHydrator(configFile, config, options);
}

export function preSerialize(config: Config) {
  if (!config.result) return;

  // This is a very weird bug
  /*config.setResult({
    raw: config.result.raw,
  });*/

  // $FlowFixMe
  config.result = {
    raw: config.result.raw,
  };
}

export function postDeserialize(config: Config, options: PluginOptions) {
  if (!config.result) return;

  return configHydrator(config.result.raw, config, options);
}
