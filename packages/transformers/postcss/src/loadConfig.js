// @flow
import type {
  Config,
  FilePath,
  PluginOptions,
  PluginLogger,
} from '@parcel/types';
import path from 'path';
import {md, generateJSONCodeHighlights} from '@parcel/diagnostic';
import nullthrows from 'nullthrows';
import clone from 'clone';
import {POSTCSS_RANGE} from './constants';

import loadExternalPlugins from './loadPlugins';

type ConfigResult = {|
  raw: any,
  filePath: string,
  hydrated: {|
    plugins: Array<any>,
    from: FilePath,
    to: FilePath,
    modules: any,
  |},
|};

async function configHydrator(
  configFile: any,
  config: Config,
  resolveFrom: FilePath,
  options: PluginOptions,
  logger: PluginLogger,
): Promise<?ConfigResult> {
  if (configFile == null) {
    return;
  }

  // Load the custom config...
  let modulesConfig;
  let configFilePlugins = clone(configFile.plugins);
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
    nullthrows(resolveFrom),
    options,
  );

  // contents is either:
  // from JSON:    { plugins: { 'postcss-foo': { ...opts } } }
  // from JS (v8): { plugins: [ { postcssPlugin: 'postcss-foo', ...visitor callback functions } ]
  // from JS (v7): { plugins: [ [Function: ...] ]
  let pluginArray = Array.isArray(configFilePlugins)
    ? configFilePlugins
    : Object.keys(configFilePlugins);
  for (let p of pluginArray) {
    if (typeof p === 'string') {
      config.addDevDependency({
        specifier: p,
        resolveFrom: nullthrows(resolveFrom),
      });
    }
  }

  let redundantPlugins = pluginArray.filter(
    p => p === 'autoprefixer' || p === 'postcss-preset-env',
  );
  if (redundantPlugins.length > 0) {
    let filename = path.basename(resolveFrom);
    let isPackageJson = filename === 'package.json';
    let message;
    let hints = [];
    if (!isPackageJson && redundantPlugins.length === pluginArray.length) {
      message = md`Parcel includes CSS transpilation and vendor prefixing by default. PostCSS config __${filename}__ contains only redundant plugins. Deleting it may significantly improve build performance.`;
      hints.push(md`Delete __${filename}__`);
    } else {
      message = md`Parcel includes CSS transpilation and vendor prefixing by default. PostCSS config __${filename}__ contains the following redundant plugins: ${[
        ...redundantPlugins,
      ].map(p =>
        md.underline(p),
      )}. Removing these may improve build performance.`;
      hints.push(md`Remove the above plugins from __${filename}__`);
    }

    let codeFrames;
    if (path.extname(filename) !== '.js') {
      let contents = await options.inputFS.readFile(resolveFrom, 'utf8');
      let prefix = isPackageJson ? '/postcss' : '';
      codeFrames = [
        {
          language: 'json',
          filePath: resolveFrom,
          code: contents,
          codeHighlights: generateJSONCodeHighlights(
            contents,
            redundantPlugins.map(plugin => ({
              key: `${prefix}/plugins/${plugin}`,
              type: 'key',
            })),
          ),
        },
      ];
    } else {
      codeFrames = [
        {
          filePath: resolveFrom,
          codeHighlights: [
            {
              start: {line: 1, column: 1},
              end: {line: 1, column: 1},
            },
          ],
        },
      ];
    }

    logger.warn({
      message,
      hints,
      documentationURL: 'https://parceljs.org/languages/css/#default-plugins',
      codeFrames,
    });
  }

  return {
    raw: configFile,
    filePath: resolveFrom,
    hydrated: {
      plugins,
      from: config.searchPath,
      to: config.searchPath,
      modules: modulesConfig,
    },
  };
}

export async function load({
  config,
  options,
  logger,
}: {|
  config: Config,
  options: PluginOptions,
  logger: PluginLogger,
|}): Promise<?ConfigResult> {
  if (!config.isSource) {
    return;
  }

  let configFile: any = await config.getConfig(
    [
      '.postcssrc',
      '.postcssrc.json',
      '.postcssrc.js',
      '.postcssrc.cjs',
      '.postcssrc.mjs',
      'postcss.config.js',
      'postcss.config.cjs',
      'postcss.config.mjs',
    ],
    {packageKey: 'postcss'},
  );

  let contents = null;
  if (configFile) {
    config.addDevDependency({
      specifier: 'postcss',
      resolveFrom: config.searchPath,
      range: POSTCSS_RANGE,
    });

    contents = configFile.contents;
    let isDynamic =
      configFile && path.extname(configFile.filePath).endsWith('js');
    if (isDynamic) {
      // We have to invalidate on startup in case the config is non-deterministic,
      // e.g. using unknown environment variables, reading from the filesystem, etc.
      logger.warn({
        message:
          'WARNING: Using a JavaScript PostCSS config file means losing out on caching features of Parcel. Use a .postcssrc(.json) file whenever possible.',
      });
    }

    if (typeof contents !== 'object') {
      throw new Error('PostCSS config should be an object.');
    }

    if (
      contents.plugins == null ||
      typeof contents.plugins !== 'object' ||
      Object.keys(contents.plugins).length === 0
    ) {
      throw new Error('PostCSS config must have plugins');
    }
  }

  return configHydrator(
    contents,
    config,
    configFile?.filePath,
    options,
    logger,
  );
}
