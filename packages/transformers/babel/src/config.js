// @flow

import type {Config, PluginOptions} from '@parcel/types';
import type {BabelConfig} from './types';
import type {PluginLogger} from '@parcel/logger';

import nullthrows from 'nullthrows';
import path from 'path';
import * as bundledBabelCore from '@babel/core';
import {md5FromObject} from '@parcel/utils';
import semver from 'semver';

import getEnvOptions from './env';
import getJSXOptions from './jsx';
import getFlowOptions from './flow';
import getTypescriptOptions from './typescript';
import {enginesToBabelTargets} from './utils';
import {BABEL_RANGE} from './constants';

const TYPESCRIPT_EXTNAME_RE = /^\.tsx?/;
const BABEL_TRANSFORMER_DIR = path.dirname(__dirname);
const JS_EXTNAME_RE = /^\.(js|cjs|mjs)$/;

export async function load(
  config: Config,
  options: PluginOptions,
  logger: PluginLogger,
): Promise<void> {
  // Don't transpile inside node_modules
  if (!config.isSource) {
    return;
  }

  let resolved = await options.packageManager.resolve(
    '@babel/core',
    config.searchPath,
    {range: BABEL_RANGE, shouldAutoInstall: options.shouldAutoInstall},
  );
  let babelCore = await options.packageManager.require(
    resolved.resolved,
    config.searchPath,
  );
  let babelOptions = {
    filename: config.searchPath,
    cwd: options.projectRoot,
    envName:
      options.env.BABEL_ENV ??
      options.env.NODE_ENV ??
      (options.mode === 'production' || options.mode === 'development'
        ? options.mode
        : null) ??
      'development',
  };

  // Only add the showIgnoredFiles option if babel is new enough, otherwise it will throw on unknown option.
  if (semver.satisfies(nullthrows(resolved.pkg).version, '^7.12.0')) {
    // $FlowFixMe
    babelOptions.showIgnoredFiles = true;
  }

  let partialConfig: ?{|
    [string]: any,
  |} = await babelCore.loadPartialConfigAsync(babelOptions);

  // Invalidate when any babel config file is added.
  config.setWatchGlob(
    '**/{.babelrc,.babelrc.js,.babelrc.json,.babelrc.cjs,.babelrc.mjs,.babelignore,babel.config.js,babel.config.json,babel.config.mjs,babel.config.cjs}',
  );

  let addIncludedFile = file => {
    if (JS_EXTNAME_RE.test(path.extname(file))) {
      logger.warn({
        message: `It looks like you're using a JavaScript Babel config file. This means the config cannot be watched for changes, and Babel transformations cannot be cached. You'll need to restart Parcel for changes to this config to take effect. Try using a ${path.basename(
          file,
          path.extname(file),
        ) + '.json'} file instead.`,
      });
      config.shouldInvalidateOnStartup();
    } else {
      config.addIncludedFile(file);
    }
  };

  let warnOldVersion = () => {
    logger.warn({
      message:
        'You are using an old version of @babel/core which does not support the necessary features for Parcel to cache and watch babel config files safely. You may need to restart Parcel for config changes to take effect. Please upgrade to @babel/core 7.12.0 or later to resolve this issue.',
    });
    config.shouldInvalidateOnStartup();
  };

  // Old versions of @babel/core return null from loadPartialConfig when the file should explicitly not be run through babel (ignore/exclude)
  if (partialConfig == null) {
    warnOldVersion();
    return;
  }

  if (partialConfig.files == null) {
    // If the files property is missing, we're on an old version of @babel/core.
    // We need to invalidate on startup because we can't properly track dependencies.
    if (partialConfig.hasFilesystemConfig()) {
      warnOldVersion();

      if (typeof partialConfig.babelrcPath === 'string') {
        addIncludedFile(partialConfig.babelrcPath);
      }

      if (typeof partialConfig.configPath === 'string') {
        addIncludedFile(partialConfig.configPath);
      }
    }
  } else {
    for (let file of partialConfig.files) {
      addIncludedFile(file);
    }
  }

  if (
    partialConfig.fileHandling != null &&
    partialConfig.fileHandling !== 'transpile'
  ) {
    return;
  } else if (partialConfig.hasFilesystemConfig()) {
    config.setResult({
      internal: false,
      config: partialConfig.options,
      targets: enginesToBabelTargets(config.env),
    });

    let {hasRequire, dependsOnLocal} = getStats(partialConfig.options, options);

    // If the config depends on local plugins or has plugins loaded with require(),
    // we can't cache the result of the compilation. If the config references local plugins,
    // we can't know what dependencies those plugins might have. If the config has require()
    // calls in it to load plugins we can't know where they came from.
    if (dependsOnLocal || hasRequire) {
      config.setResultHash(JSON.stringify(Date.now()));
      config.shouldInvalidateOnStartup();
    }

    if (dependsOnLocal) {
      logger.warn({
        message:
          "It looks like you are using local Babel plugins or presets. This means Babel transformations cannot be cached and will run on each build. You'll need to restart Parcel for changes to local plugins to take effect.",
      });
    } else if (hasRequire) {
      logger.warn({
        message:
          'It looks like you are using `require` to configure Babel plugins or presets. This means Babel transformations cannot be cached and will run on each build. Please use strings to configure Babel instead.',
      });
    } else {
      await definePluginDependencies(config);
      config.setResultHash(md5FromObject(partialConfig.options));
    }
  } else {
    await buildDefaultBabelConfig(options, config);
  }
}

async function buildDefaultBabelConfig(options: PluginOptions, config: Config) {
  let jsxOptions = await getJSXOptions(options, config);

  let babelOptions;
  if (path.extname(config.searchPath).match(TYPESCRIPT_EXTNAME_RE)) {
    babelOptions = getTypescriptOptions(
      config,
      jsxOptions?.pragma,
      jsxOptions?.pragmaFrag,
    );
  } else {
    babelOptions = await getFlowOptions(config, options);
  }

  let babelTargets;
  let envOptions = await getEnvOptions(config);
  if (envOptions != null) {
    babelTargets = envOptions.targets;
    babelOptions = mergeOptions(babelOptions, envOptions.config);
  }
  babelOptions = mergeOptions(babelOptions, jsxOptions?.config);

  if (babelOptions != null) {
    babelOptions.presets = (babelOptions.presets || []).map(preset =>
      bundledBabelCore.createConfigItem(preset, {
        type: 'preset',
        dirname: BABEL_TRANSFORMER_DIR,
      }),
    );
    babelOptions.plugins = (babelOptions.plugins || []).map(plugin =>
      bundledBabelCore.createConfigItem(plugin, {
        type: 'plugin',
        dirname: BABEL_TRANSFORMER_DIR,
      }),
    );
  }

  config.setResult({
    internal: true,
    config: babelOptions,
    targets: babelTargets,
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

function getStats(options, parcelOptions) {
  let hasRequire = false;
  let dependsOnLocal = false;

  let configItems = [...options.presets, ...options.plugins];

  for (let configItem of configItems) {
    if (!configItem.file) {
      hasRequire = true;
    } else if (
      configItem.file.request.startsWith('.') ||
      isLocal(configItem.file.resolved, parcelOptions.inputFS)
    ) {
      dependsOnLocal = true;
    }
  }

  return {hasRequire, dependsOnLocal};
}

function isLocal(configItemPath, fs) {
  return fs.realpathSync(configItemPath) !== configItemPath;
}

export function preSerialize(config: Config) {
  let babelConfig = config.result?.config;
  if (babelConfig == null) {
    return;
  }

  // ConfigItem.value is a function which the v8 serializer chokes on
  // It is being ommited here and will be rehydrated later using the path provided by ConfigItem.file
  babelConfig.presets = (babelConfig.presets || []).map(
    ({options, dirname, name, file}) => ({
      options,
      dirname,
      name,
      file,
    }),
  );
  babelConfig.plugins = (babelConfig.plugins || []).map(
    ({options, dirname, name, file}) => ({
      options,
      dirname,
      name,
      file,
    }),
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
          parse: true,
        }),
      ).contents;
      config.addDevDependency(pkg.name, pkg.version);
    }),
  );
}

export async function postDeserialize(config: Config, options: PluginOptions) {
  let babelCore = config.result.internal
    ? bundledBabelCore
    : await options.packageManager.require('@babel/core', config.searchPath, {
        shouldAutoInstall: options.shouldAutoInstall,
      });

  config.result.config.presets = await Promise.all(
    config.result.config.presets.map(async configItem => {
      let value = await options.packageManager.require(
        configItem.file.resolved,
        config.searchPath,
        {shouldAutoInstall: options.shouldAutoInstall},
      );
      value = value.default ? value.default : value;
      return babelCore.createConfigItem([value, configItem.options], {
        type: 'preset',
        dirname: configItem.dirname,
      });
    }),
  );
  config.result.config.plugins = await Promise.all(
    config.result.config.plugins.map(async configItem => {
      let value = await options.packageManager.require(
        configItem.file.resolved,
        config.searchPath,
        {shouldAutoInstall: options.shouldAutoInstall},
      );
      value = value.default ? value.default : value;
      return babelCore.createConfigItem([value, configItem.options], {
        type: 'plugin',
        dirname: configItem.dirname,
      });
    }),
  );
}
