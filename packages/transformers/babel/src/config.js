// @flow

import type {Config, PluginOptions} from '@parcel/types';
import type {BabelConfig} from './types';

import nullthrows from 'nullthrows';
import path from 'path';
import {loadPartialConfig, createConfigItem} from '@babel/core';
import {md5FromObject} from '@parcel/utils';
import logger from '@parcel/logger';

import getEnvOptions from './env';
import getJSXOptions from './jsx';
import getFlowOptions from './flow';
import getTypescriptOptions from './typescript';
import {enginesToBabelTargets} from './utils';

const TYPESCRIPT_EXTNAME_RE = /^\.tsx?/;
const BABEL_TRANSFORMER_DIR = path.dirname(__dirname);

export async function load(config: Config, options: PluginOptions) {
  if (!config.isSource) {
    return;
  }

  if (config.result != null) {
    return reload(config, options);
  }

  // Don't look for a custom babel config if inside node_modules
  if (!config.isSource) {
    return buildDefaultBabelConfig(config);
  }

  let partialConfig = loadPartialConfig({
    filename: config.searchPath,
    cwd: path.dirname(config.searchPath),
    root: options.projectRoot
  });

  // loadPartialConfig returns null when the file should explicitly not be run through babel (ignore/exclude)
  if (partialConfig == null) {
    return;
  } else if (partialConfig.hasFilesystemConfig()) {
    let {babelrc, config: configjs} = partialConfig;
    let {canBeRehydrated, dependsOnRelative, dependsOnLocal} = getStats(
      partialConfig.options
    );

    let configIsJS =
      (babelrc != null && path.extname(babelrc) === '.js') || configjs != null;

    // babel.config.js files get required by @babel/core so there's no use in including it for watch mode invalidation
    if (configIsJS) {
      logger.verbose(
        'WARNING: Using a JavaScript Babel config file means losing out on some caching features of Parcel. Try using a .babelrc file instead.'
      );
      config.shouldInvalidateOnStartup();
    } else {
      config.setResolvedPath(babelrc);
    }

    if (babelrc && (await isExtended(/*babelrc*/))) {
      logger.verbose(
        'WARNING: You are using `extends` in your Babel config, which means you are losing out on some of the caching features of Parcel. Maybe try using a reusable preset instead.'
      );
      config.shouldInvalidateOnStartup();
    }

    if (dependsOnRelative || dependsOnLocal) {
      logger.verbose(
        'WARNING: It looks like you are using local Babel plugins or presets. You will need to run with the `--no-cache` option in order to pick up changes to these until their containing package versions are bumped.'
      );
    }

    if (canBeRehydrated) {
      prepForReyhdration(partialConfig.options);
      config.shouldRehydrate();
      config.setResult({
        internal: false,
        config: partialConfig.options,
        targets: enginesToBabelTargets(config.env)
      });

      await definePluginDependencies(config);
      config.setResultHash(md5FromObject(partialConfig.options));
    } else {
      logger.warn(
        'WARNING: You are using `require` to configure Babel plugins or presets. This means Babel transformations cannot be cached and will run on each build. Please use strings to configure Babel instead.'
      );
      config.shouldReload();
      config.setResult({
        internal: false
      });
      config.setResultHash(JSON.stringify(Date.now()));
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
    babelOptions = getFlowOptions(config);
  }

  let babelTargets;
  let envOptions = await getEnvOptions(config);
  if (envOptions != null) {
    babelTargets = envOptions.targets;
    babelOptions = mergeOptions(babelOptions, {presets: envOptions.presets});
  }
  babelOptions = mergeOptions(babelOptions, await getJSXOptions(config));

  if (babelOptions != null) {
    babelOptions.presets = (babelOptions.presets || []).map(preset =>
      createConfigItem(preset, {
        type: 'preset',
        dirname: BABEL_TRANSFORMER_DIR
      })
    );
    babelOptions.plugins = (babelOptions.plugins || []).map(plugin =>
      createConfigItem(plugin, {
        type: 'plugin',
        dirname: BABEL_TRANSFORMER_DIR
      })
    );
    config.shouldRehydrate();
    prepForReyhdration(babelOptions);
  }

  config.setResult({
    internal: true,
    config: babelOptions,
    targets: babelTargets
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

function isExtended(/* babelrcPath */) {
  // TODO: read and parse babelrc and check to see if extends property exists
  // need access to fs in case of memory filesystem
  return false;
}

function isLocal(/* configItemPath */) {
  // TODO: check if realpath is different, need access to fs in case of memory filesystem
  return false;
}

function prepForReyhdration(options) {
  // ConfigItem.value is a function which the v8 serializer chokes on
  // It is being ommited here and will be rehydrated later using the path provided by ConfigItem.file
  options.presets = (options.presets || []).map(
    ({options, dirname, name, file}) => ({
      options,
      dirname,
      name,
      file
    })
  );
  options.plugins = (options.plugins || []).map(
    ({options, dirname, name, file}) => ({
      options,
      dirname,
      name,
      file
    })
  );
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

export async function rehydrate(config: Config, options: PluginOptions) {
  let babelCore = config.result.internal
    ? require('@babel/core')
    : await options.packageManager.require('@babel/core', config.searchPath);

  config.result.config.presets = await Promise.all(
    config.result.config.presets.map(async configItem => {
      let value = await options.packageManager.require(
        configItem.file.resolved,
        config.searchPath
      );
      value = value.default ? value.default : value;
      return babelCore.createConfigItem([value, configItem.options], {
        type: 'preset',
        dirname: configItem.dirname
      });
    })
  );
  config.result.config.plugins = await Promise.all(
    config.result.config.plugins.map(async configItem => {
      let value = await options.packageManager.require(
        configItem.file.resolved,
        config.searchPath
      );
      value = value.default ? value.default : value;
      return babelCore.createConfigItem([value, configItem.options], {
        type: 'plugin',
        dirname: configItem.dirname
      });
    })
  );
}

export async function reload(config: Config, options: PluginOptions) {
  let babelCore = await options.packageManager.require(
    '@babel/core',
    config.searchPath
  );

  let partialConfig = babelCore.loadPartialConfig({
    filename: config.searchPath,
    cwd: path.dirname(config.searchPath),
    root: options.projectRoot
  });

  config.setResult({
    internal: false,
    config: partialConfig.options,
    targets: enginesToBabelTargets(config.env)
  });
}
