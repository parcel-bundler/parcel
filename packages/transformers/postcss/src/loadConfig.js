// @flow
import type {Config, PluginOptions} from '@parcel/types';
import type {PluginLogger} from '@parcel/logger';
import path from 'path';

import loadExternalPlugins from './loadPlugins';

const MODULE_BY_NAME_RE = /\.module\./;

async function configHydrator(
  configFile: any,
  config: Config,
  options: PluginOptions,
) {
  // Use a basic, modules-only PostCSS config if the file opts in by a name
  // like foo.module.css
  if (configFile == null && config.searchPath.match(MODULE_BY_NAME_RE)) {
    configFile = {
      plugins: {
        'postcss-modules': {},
      },
    };
  }

  if (configFile == null) {
    return;
  }

  // Load the custom config...
  let modulesConfig;
  let configFilePlugins = configFile.plugins;
  if (
    configFilePlugins != null &&
    typeof configFilePlugins === 'object' &&
    configFilePlugins['postcss-modules'] != null
  ) {
    modulesConfig = configFilePlugins['postcss-modules'];
    delete configFilePlugins['postcss-modules'];
  }

  if (!modulesConfig && configFile.modules) {
    modulesConfig = {};
  }

  let plugins = await loadExternalPlugins(
    configFilePlugins,
    config.searchPath,
    options,
  );

  return config.setResult({
    raw: configFile,
    hydrated: {
      plugins,
      from: config.searchPath,
      to: config.searchPath,
      modules: modulesConfig,
    },
  });
}

export async function load({
  config,
  options,
  logger,
}: {|
  config: Config,
  options: PluginOptions,
  logger: PluginLogger,
|}) {
  let configFile: any = await config.getConfig(
    ['.postcssrc', '.postcssrc.json', '.postcssrc.js', 'postcss.config.js'],
    {packageKey: 'postcss'},
  );

  let contents = null;
  if (configFile) {
    contents = configFile.contents;
    let isDynamic = configFile && path.extname(configFile.filePath) === '.js';
    if (isDynamic) {
      logger.warn({
        message:
          'WARNING: Using a JavaScript PostCSS config file means losing out on caching features of Parcel. Use a .postcssrc(.json) file whenever possible.',
      });

      config.shouldInvalidateOnStartup();
    }

    if (typeof contents !== 'object') {
      throw new Error('PostCSS config should be an object.');
    }

    if (
      contents.plugins == null ||
      typeof contents.plugins !== 'object' ||
      Object.keys(contents.plugins) === 0
    ) {
      throw new Error('PostCSS config must have plugins');
    }

    let configFilePlugins = Array.isArray(contents.plugins)
      ? contents.plugins
      : Object.keys(contents.plugins);
    for (let p of configFilePlugins) {
      // JavaScript configs can use an array of functions... opt out of all caching...
      if (typeof p === 'function') {
        contents.__contains_functions = true;

        // This should enforce the config to be revalidated as it can contain functions and is JS
        config.shouldInvalidateOnStartup();
        config.shouldReload();
      }

      if (typeof p === 'string') {
        if (p.startsWith('.')) {
          logger.warn({
            message:
              'WARNING: Using relative PostCSS plugins means losing out on caching features of Parcel. Bundle this plugin up in a package or use a monorepo to resolve this issue.',
          });

          config.shouldInvalidateOnStartup();
        }

        config.addDevDependency(p);
      }
    }
  }

  return configHydrator(contents, config, options);
}

export function preSerialize(config: Config) {
  if (!config.result) return;

  // Ensure we dont pass functions to the serialiser
  if (config.result.raw.__contains_functions) {
    config.result.raw = {};
  }

  // This gets re-hydrated in Deserialize, so never store this.
  // It also usually contains a bunch of functions so bad idea anyway...
  config.result.hydrated = {};
}

export function postDeserialize(config: Config, options: PluginOptions) {
  return configHydrator(config.result.raw, config, options);
}
