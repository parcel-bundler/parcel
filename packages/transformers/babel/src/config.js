// @flow
import type {Config, PluginOptions} from '@parcel/types';

import nullthrows from 'nullthrows';
import path from 'path';
import {loadPartialConfig, createConfigItem} from '@babel/core';
import {md5FromObject} from '@parcel/utils';

import getEnvOptions from './env';
import getJSXOptions from './jsx';
import getFlowOptions from './flow';
import getTypescriptOptions from './typescript';
import type {BabelConfig} from './types';

const TYPESCRIPT_EXTNAME_RE = /^\.tsx?/;
const BABEL_TRANSFORMER_DIR = path.dirname(__dirname);

export async function load(config: Config, options: PluginOptions) {
  let partialConfig = loadPartialConfig({
    filename: config.searchPath,
    cwd: path.dirname(config.searchPath),
    root: options.projectRoot
  });
  if (partialConfig && partialConfig.hasFilesystemConfig()) {
    let {babelrc, config: configjs} = partialConfig;
    let {canBeRehydrated, dependsOnRelative, dependsOnLocal} = getStats(
      partialConfig.options
    );

    // babel.config.js files get required by @babel/core so there's no use in including it for watch mode invalidation
    if (babelrc != null && configjs == null) {
      config.setResolvedPath(babelrc);
    } else if (configjs) {
      // TODO: warn about invalidation on startup
      config.shouldInvalidateOnStartup();
    }

    if (babelrc && (await isExtended(/*babelrc*/))) {
      // TODO: warn about invalidation on startup
      // TODO: maybe add feature to babel that gives details on extended files?
      config.shouldInvalidateOnStartup();
    }

    if (dependsOnRelative || dependsOnLocal) {
      // TODO: warn that you may not see changes to relative or local plugins/presets until their
      // containing package changes versions. You can run with --no-cache to see changes until ready
      // to bump version.
    }

    if (canBeRehydrated) {
      prepForReyhdration(partialConfig.options);
      config.shouldRehydrate();
      config.setResult({
        internal: false,
        config: partialConfig.options
      });

      await definePluginDependencies(config);
      config.setResultHash(md5FromObject(partialConfig.options));
    } else {
      config.shouldReload();
      config.setResultHash(JSON.stringify(Date.now()));
      // TODO: warn about invalidation on startup
      config.shouldInvalidateOnStartup();
    }
  } else {
    await buildDefaultBabelConfig(config);
  }
}

async function buildDefaultBabelConfig(config: Config) {
  let babelOptions;
  if (path.extname(config.searchPath).match(TYPESCRIPT_EXTNAME_RE)) {
    babelOptions = getTypescriptOptions(config);
  } else {
    babelOptions = await getFlowOptions(config);
  }

  babelOptions = mergeOptions(babelOptions, await getEnvOptions(config));
  babelOptions = mergeOptions(babelOptions, await getJSXOptions(config));

  if (babelOptions != null) {
    babelOptions.presets = (babelOptions.presets || []).map(preset =>
      createConfigItem(preset, {type: 'preset', dirname: BABEL_TRANSFORMER_DIR})
    );
    babelOptions.plugins = (babelOptions.plugins || []).map(plugin =>
      createConfigItem(plugin, {type: 'plugin', dirname: BABEL_TRANSFORMER_DIR})
    );
    config.shouldRehydrate();
    prepForReyhdration(babelOptions);
  }

  config.setResult({
    internal: true,
    config: babelOptions
  });
  await definePluginDependencies(config);
}

function mergeOptions(result, config?: null | BabelConfig) {
  if (
    !config ||
    ((!config.presets || config.presets.length === 0) &&
      (!config.plugins || config.plugins.length === 0))
  ) {
    return result;
  }

  let merged = result;
  if (merged) {
    merged.presets = (merged.presets || []).concat(config.presets || []);
    merged.plugins = (merged.plugins || []).concat(config.plugins || []);
  } else {
    result = config;
  }

  return result;
}

function getStats(options) {
  let canBeRehydrated = true;
  let dependsOnRelative = false;
  let dependsOnLocal = false;

  let configItems = [...options.presets, ...options.plugins];

  for (let configItem of configItems) {
    if (!configItem.file) {
      canBeRehydrated = false;
    } else if (configItem.file.request.startsWith('.')) {
      dependsOnRelative = true;
    } else if (isLocal(/*configItem.file.resolved*/)) {
      dependsOnLocal = true;
    }
  }

  return {canBeRehydrated, dependsOnRelative, dependsOnLocal};
}

async function isExtended(/* babelrcPath */) {
  // TODO: read and parse babelrc and check to see if extends property exists
  // need access to fs in case of memory filesystem
  return false;
}

async function isLocal(/* configItemPath */) {
  // TODO: check if realpath is different, need access to fs in case of memory filesystem
  return false;
}

function prepForReyhdration(options) {
  // ConfigItem.value is a function which the v8 serializer chokes on
  // It is being ommited here and will be rehydrated later using the path provided by ConfigItem.file
  options.presets = (options.presets || []).map(configItem => ({
    file: configItem.file,
    options: configItem.options
  }));
  options.plugins = (options.plugins || []).map(configItem => ({
    file: configItem.file,
    options: configItem.options
  }));
}

async function definePluginDependencies(config) {
  let babelConfig = config.result.config;
  if (babelConfig == null) {
    return;
  }

  let configItems = [...babelConfig.presets, ...babelConfig.plugins];
  await Promise.all(
    configItems.map(async configItem => {
      let pkg = nullthrows(
        await config.getConfigFrom(configItem.file.resolved, ['package.json'], {
          parse: true
        })
      );
      config.addDevDependency(pkg.name, pkg.version);
    })
  );
}

export function rehydrate(config: Config) {
  config.result.config.presets = config.result.config.presets.map(
    configItem => {
      // $FlowFixMe
      let value = require(configItem.file.resolved);
      value = value.default ? value.default : value;
      return createConfigItem([value, configItem.options], {type: 'preset'});
    }
  );
  config.result.config.plugins = config.result.config.plugins.map(
    configItem => {
      // $FlowFixMe
      let value = require(configItem.file.resolved);
      value = value.default ? value.default : value;
      return createConfigItem([value, configItem.options], {type: 'plugin'});
    }
  );
}
