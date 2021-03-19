// @flow

import type {Config, PluginOptions} from '@parcel/types';
import type {BabelConfig} from './types';
import type {PluginLogger} from '@parcel/logger';

import path from 'path';
import * as babelCore from '@babel/core';
import {md5FromObject, relativePath} from '@parcel/utils';

import getEnvOptions from './env';
import getJSXOptions from './jsx';
import getFlowOptions from './flow';
import getTypescriptOptions from './typescript';
import {enginesToBabelTargets} from './utils';

const TYPESCRIPT_EXTNAME_RE = /^\.tsx?/;
const BABEL_TRANSFORMER_DIR = path.dirname(__dirname);
const JS_EXTNAME_RE = /^\.(js|cjs|mjs)$/;
const BABEL_CONFIG_FILENAMES = [
  '.babelrc',
  '.babelrc.js',
  '.babelrc.json',
  '.babelrc.cjs',
  '.babelrc.mjs',
  '.babelignore',
  'babel.config.js',
  'babel.config.json',
  'babel.config.mjs',
  'babel.config.cjs',
];

export async function load(
  config: Config,
  options: PluginOptions,
  logger: PluginLogger,
): Promise<void> {
  // Don't transpile inside node_modules
  if (!config.isSource) {
    return;
  }

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
    showIgnoredFiles: true,
  };

  let partialConfig: ?{|
    [string]: any,
  |} = await babelCore.loadPartialConfigAsync(babelOptions);

  // Invalidate when any babel config file is added.
  for (let fileName of BABEL_CONFIG_FILENAMES) {
    config.invalidateOnFileCreate({
      fileName,
      aboveFilePath: config.searchPath,
    });
  }

  let addIncludedFile = file => {
    if (JS_EXTNAME_RE.test(path.extname(file))) {
      // We need to invalidate on startup in case the config is non-static,
      // e.g. uses unknown environment variables, reads from the filesystem, etc.
      logger.warn({
        message: `It looks like you're using a JavaScript Babel config file. This means the config cannot be watched for changes, and Babel transformations cannot be cached. You'll need to restart Parcel for changes to this config to take effect. Try using a ${path.basename(
          file,
          path.extname(file),
        ) + '.json'} file instead.`,
      });
      config.shouldInvalidateOnStartup();

      // But also add the config as a dev dependency so we can at least attempt invalidation in watch mode.
      config.addDevDependency({
        moduleSpecifier: relativePath(options.projectRoot, file),
        resolveFrom: path.join(options.projectRoot, 'index'),
        // Also invalidate @parcel/transformer-babel when the config or a dependency updates.
        // This ensures that the caches in @babel/core are also invalidated.
        invalidateParcelPlugin: true,
      });
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

    // If the config has plugins loaded with require(), or inline plugins in the config,
    // we can't cache the result of the compilation because we don't know where they came from.
    if (hasRequire(partialConfig.options)) {
      logger.warn({
        message:
          'It looks like you are using `require` to configure Babel plugins or presets. This means Babel transformations cannot be cached and will run on each build. Please use strings to configure Babel instead.',
      });

      config.setResultHash(JSON.stringify(Date.now()));
      config.shouldInvalidateOnStartup();
    } else {
      definePluginDependencies(config, options);
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
    let _babelOptions = babelOptions; // For Flow
    _babelOptions.presets = (_babelOptions.presets || []).map(preset =>
      babelCore.createConfigItem(preset, {
        type: 'preset',
        dirname: BABEL_TRANSFORMER_DIR,
      }),
    );
    _babelOptions.plugins = (_babelOptions.plugins || []).map(plugin =>
      babelCore.createConfigItem(plugin, {
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
  definePluginDependencies(config, options);
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

function hasRequire(options) {
  let configItems = [...options.presets, ...options.plugins];
  return configItems.some(item => !item.file);
}

function definePluginDependencies(config, options) {
  let babelConfig = config.result.config;
  if (babelConfig == null) {
    return;
  }

  let configItems = [...babelConfig.presets, ...babelConfig.plugins];
  for (let configItem of configItems) {
    // FIXME: this uses a relative path from the project root rather than resolving
    // from the config location because configItem.file.request can be a shorthand
    // rather than a full package name.
    config.addDevDependency({
      moduleSpecifier: relativePath(
        options.projectRoot,
        configItem.file.resolved,
      ),
      resolveFrom: path.join(options.projectRoot, 'index'),
      // Also invalidate @parcel/transformer-babel when the plugin or a dependency updates.
      // This ensures that the caches in @babel/core are also invalidated.
      invalidateParcelPlugin: true,
    });
  }
}
