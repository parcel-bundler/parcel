// @flow

import type {Config, PluginOptions, PluginLogger} from '@parcel/types';
import typeof * as BabelCore from '@babel/core';
import type {Diagnostic} from '@parcel/diagnostic';
import type {BabelConfig} from './types';

import json5 from 'json5';
import path from 'path';
import {hashObject, relativePath, resolveConfig} from '@parcel/utils';
import {md, generateJSONCodeHighlights} from '@parcel/diagnostic';
import {BABEL_CORE_RANGE} from './constants';

import isJSX from './jsx';
import getFlowOptions from './flow';
import {enginesToBabelTargets} from './utils';

const TYPESCRIPT_EXTNAME_RE = /\.tsx?$/;
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

type BabelConfigResult = {|
  internal: boolean,
  config: BabelConfig,
  targets?: mixed,
  syntaxPlugins?: mixed,
|};

export async function load(
  config: Config,
  options: PluginOptions,
  logger: PluginLogger,
): Promise<?BabelConfigResult> {
  // Don't transpile inside node_modules
  if (!config.isSource) {
    return;
  }

  // Invalidate when any babel config file is added.
  for (let fileName of BABEL_CONFIG_FILENAMES) {
    config.invalidateOnFileCreate({
      fileName,
      aboveFilePath: config.searchPath,
    });
  }

  // Do nothing if we cannot resolve any babel config filenames. Checking using our own
  // config resolution (which is cached) is much faster than relying on babel.
  if (
    !(await resolveConfig(
      options.inputFS,
      config.searchPath,
      BABEL_CONFIG_FILENAMES,
      options.projectRoot,
    ))
  ) {
    return buildDefaultBabelConfig(options, config);
  }

  const babelCore: BabelCore = await options.packageManager.require(
    '@babel/core',
    config.searchPath,
    {
      range: BABEL_CORE_RANGE,
      saveDev: true,
      shouldAutoInstall: options.shouldAutoInstall,
    },
  );
  config.addDevDependency({
    specifier: '@babel/core',
    resolveFrom: config.searchPath,
    range: BABEL_CORE_RANGE,
  });

  config.invalidateOnEnvChange('BABEL_ENV');
  config.invalidateOnEnvChange('NODE_ENV');
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

  let addIncludedFile = file => {
    if (JS_EXTNAME_RE.test(path.extname(file))) {
      // We need to invalidate on startup in case the config is non-static,
      // e.g. uses unknown environment variables, reads from the filesystem, etc.
      logger.warn({
        message: `It looks like you're using a JavaScript Babel config file. This means the config cannot be watched for changes, and Babel transformations cannot be cached. You'll need to restart Parcel for changes to this config to take effect. Try using a ${
          path.basename(file, path.extname(file)) + '.json'
        } file instead.`,
      });
      config.invalidateOnStartup();

      // But also add the config as a dev dependency so we can at least attempt invalidation in watch mode.
      config.addDevDependency({
        specifier: relativePath(options.projectRoot, file),
        resolveFrom: path.join(options.projectRoot, 'index'),
        // Also invalidate @babel/core when the config or a dependency updates.
        // This ensures that the caches in @babel/core are also invalidated.
        additionalInvalidations: [
          {
            specifier: '@babel/core',
            resolveFrom: config.searchPath,
            range: BABEL_CORE_RANGE,
          },
        ],
      });
    } else {
      config.invalidateOnFileChange(file);
    }
  };

  let warnOldVersion = () => {
    logger.warn({
      message:
        'You are using an old version of @babel/core which does not support the necessary features for Parcel to cache and watch babel config files safely. You may need to restart Parcel for config changes to take effect. Please upgrade to @babel/core 7.12.0 or later to resolve this issue.',
    });
    config.invalidateOnStartup();
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
    // Determine what syntax plugins we need to enable
    let syntaxPlugins = [];
    if (TYPESCRIPT_EXTNAME_RE.test(config.searchPath)) {
      syntaxPlugins.push('typescript');
      if (config.searchPath.endsWith('.tsx')) {
        syntaxPlugins.push('jsx');
      }
    } else if (await isJSX(options, config)) {
      syntaxPlugins.push('jsx');
    }

    // If the config has plugins loaded with require(), or inline plugins in the config,
    // we can't cache the result of the compilation because we don't know where they came from.
    if (hasRequire(partialConfig.options)) {
      logger.warn({
        message:
          'It looks like you are using `require` to configure Babel plugins or presets. This means Babel transformations cannot be cached and will run on each build. Please use strings to configure Babel instead.',
      });

      config.setCacheKey(JSON.stringify(Date.now()));
      config.invalidateOnStartup();
    } else {
      await warnOnRedundantPlugins(options.inputFS, partialConfig, logger);
      definePluginDependencies(config, partialConfig.options, options);
      config.setCacheKey(hashObject(partialConfig.options));
    }

    return {
      internal: false,
      config: partialConfig.options,
      targets: enginesToBabelTargets(config.env),
      syntaxPlugins,
    };
  } else {
    return buildDefaultBabelConfig(options, config);
  }
}

async function buildDefaultBabelConfig(
  options: PluginOptions,
  config: Config,
): Promise<?BabelConfigResult> {
  // If this is a .ts or .tsx file, we don't need to enable flow.
  if (TYPESCRIPT_EXTNAME_RE.test(config.searchPath)) {
    return;
  }

  // Detect flow. If not enabled, babel doesn't need to run at all.
  let babelOptions = await getFlowOptions(config, options);
  if (babelOptions == null) {
    return;
  }

  // When flow is enabled, we may also need to enable JSX so it parses properly.
  let syntaxPlugins = [];
  if (await isJSX(options, config)) {
    syntaxPlugins.push('jsx');
  }

  definePluginDependencies(config, babelOptions, options);
  return {
    internal: true,
    config: babelOptions,
    syntaxPlugins,
  };
}

function hasRequire(options) {
  let configItems = [...options.presets, ...options.plugins];
  return configItems.some(item => !item.file);
}

function definePluginDependencies(config, babelConfig: ?BabelConfig, options) {
  if (babelConfig == null) {
    return;
  }

  let configItems = [
    ...(babelConfig.presets || []),
    ...(babelConfig.plugins || []),
  ];
  for (let configItem of configItems) {
    // FIXME: this uses a relative path from the project root rather than resolving
    // from the config location because configItem.file.request can be a shorthand
    // rather than a full package name.
    config.addDevDependency({
      specifier: relativePath(options.projectRoot, configItem.file.resolved),
      resolveFrom: path.join(options.projectRoot, 'index'),
      // Also invalidate @babel/core when the plugin or a dependency updates.
      // This ensures that the caches in @babel/core are also invalidated.
      additionalInvalidations: [
        {
          specifier: '@babel/core',
          resolveFrom: config.searchPath,
          range: BABEL_CORE_RANGE,
        },
      ],
    });
  }
}

const redundantPresets = new Set([
  '@babel/preset-env',
  '@babel/preset-react',
  '@babel/preset-typescript',
  '@parcel/babel-preset-env',
]);

async function warnOnRedundantPlugins(fs, babelConfig, logger) {
  if (babelConfig == null) {
    return;
  }

  let configPath = babelConfig.config ?? babelConfig.babelrc;
  if (!configPath) {
    return;
  }

  let presets = babelConfig.options.presets || [];
  let plugins = babelConfig.options.plugins || [];
  let foundRedundantPresets = new Set();

  let filteredPresets = presets.filter(preset => {
    if (redundantPresets.has(preset.file.request)) {
      foundRedundantPresets.add(preset.file.request);
      return false;
    }

    return true;
  });

  let filePath = path.relative(process.cwd(), configPath);
  let diagnostics: Array<Diagnostic> = [];

  if (
    filteredPresets.length === 0 &&
    foundRedundantPresets.size > 0 &&
    plugins.length === 0
  ) {
    diagnostics.push({
      message: md`Parcel includes transpilation by default. Babel config __${filePath}__ contains only redundant presets. Deleting it may significantly improve build performance.`,
      codeFrames: [
        {
          filePath: configPath,
          codeHighlights: await getCodeHighlights(
            fs,
            configPath,
            foundRedundantPresets,
          ),
        },
      ],
      hints: [md`Delete __${filePath}__`],
      documentationURL:
        'https://parceljs.org/languages/javascript/#default-presets',
    });
  } else if (foundRedundantPresets.size > 0) {
    diagnostics.push({
      message: md`Parcel includes transpilation by default. Babel config __${filePath}__ includes the following redundant presets: ${[
        ...foundRedundantPresets,
      ].map(p =>
        md.underline(p),
      )}. Removing these may improve build performance.`,
      codeFrames: [
        {
          filePath: configPath,
          codeHighlights: await getCodeHighlights(
            fs,
            configPath,
            foundRedundantPresets,
          ),
        },
      ],
      hints: [md`Remove the above presets from __${filePath}__`],
      documentationURL:
        'https://parceljs.org/languages/javascript/#default-presets',
    });
  }

  if (foundRedundantPresets.has('@babel/preset-env')) {
    diagnostics.push({
      message:
        "@babel/preset-env does not support Parcel's targets, which will likely result in unnecessary transpilation and larger bundle sizes.",
      codeFrames: [
        {
          filePath: babelConfig.config ?? babelConfig.babelrc,
          codeHighlights: await getCodeHighlights(
            fs,
            babelConfig.config ?? babelConfig.babelrc,
            new Set(['@babel/preset-env']),
          ),
        },
      ],
      hints: [
        `Either remove __@babel/preset-env__ to use Parcel's builtin transpilation, or replace with __@parcel/babel-preset-env__`,
      ],
      documentationURL:
        'https://parceljs.org/languages/javascript/#custom-plugins',
    });
  }

  if (diagnostics.length > 0) {
    logger.warn(diagnostics);
  }
}

async function getCodeHighlights(fs, filePath, redundantPresets) {
  let ext = path.extname(filePath);
  if (ext !== '.js' && ext !== '.cjs' && ext !== '.mjs') {
    let contents = await fs.readFile(filePath, 'utf8');
    let json = json5.parse(contents);

    let presets = json.presets || [];
    let pointers = [];
    for (let i = 0; i < presets.length; i++) {
      if (Array.isArray(presets[i]) && redundantPresets.has(presets[i][0])) {
        pointers.push({type: 'value', key: `/presets/${i}/0`});
      } else if (redundantPresets.has(presets[i])) {
        pointers.push({type: 'value', key: `/presets/${i}`});
      }
    }

    if (pointers.length > 0) {
      return generateJSONCodeHighlights(contents, pointers);
    }
  }

  return [
    {
      start: {
        line: 1,
        column: 1,
      },
      end: {
        line: 1,
        column: 1,
      },
    },
  ];
}
