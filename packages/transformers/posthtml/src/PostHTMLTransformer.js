// @flow
import type {ConfigResult} from '@parcel/types';
import type {PluginLogger} from '@parcel/logger';
import type {PostHTMLOptions} from 'posthtml';

import {Transformer} from '@parcel/plugin';

import posthtml from 'posthtml';
import parse from 'posthtml-parser';
import render from 'posthtml-render';
import nullthrows from 'nullthrows';
import semver from 'semver';
import loadPlugins from './loadPlugins';

const canSerializeConfig = (config: ConfigResult, logger: PluginLogger) => {
  if (!config || !config.plugins) {
    return true;
  }
  if (Array.isArray(config.plugins)) {
    const hasOnlyStringPlugins = config.plugins.every(
      plugin => typeof plugin === 'string',
    );
    if (!hasOnlyStringPlugins) {
      logger.verbose({
        message:
          'WARNING: You are using non-serializable plugins to configure PostHTML. This means PostHTML transformations cannot be cached and will run on each build. Please use strings to configure PostHTML instead.',
      });
    }
    return hasOnlyStringPlugins;
  } else if (typeof config.plugins === 'object') {
    const usesFunctionPluginValue = Object.values(config.plugins).every(
      plugin => typeof plugin === 'string',
    );
    if (usesFunctionPluginValue) {
      logger.verbose({
        message:
          'WARNING: You are using non-serializable plugins to configure PostHTML. This means PostHTML transformations cannot be cached and will run on each build. Please use an object to configure PostHTML plugins instead of including the plugin directly.',
      });
    }
    return !usesFunctionPluginValue;
  }
  return true;
};

export default new Transformer({
  async loadConfig({config, options, logger}) {
    let loaded = await config.getConfig([
      '.posthtmlrc',
      '.posthtmlrc.js',
      'posthtml.config.js',
    ]);

    loaded = loaded || {};
    loaded.skipParse = true;

    if (!canSerializeConfig(loaded, logger)) {
      config.setResult({fullyLoaded: loaded});
      config.shouldInvalidateOnStartup();
      config.setResultHash(JSON.stringify(Date.now()));
    } else {
      let fullyLoaded = {
        ...loaded,
        plugins: await loadPlugins(loaded.plugins, config.searchPath, options),
      };
      config.setResult({
        loaded,
        fullyLoaded,
      });
    }
  },

  preSerializeConfig({config}) {
    // remove fullyLoaded so v8 doesn't choke on functions
    delete config.result.fullyLoaded;
  },

  async postDeserializeConfig({config, options}) {
    let configResult = config.result;
    let {loaded} = configResult;

    if (!loaded) {
      loaded = await config.getConfig([
        '.posthtmlrc',
        '.posthtmlrc.js',
        'posthtml.config.js',
      ]);
      loaded = loaded || {};
      loaded.skipParse = true;
      configResult.fullyLoaded = loaded;
    } else {
      configResult.fullyLoaded = {
        ...loaded,
        plugins: await loadPlugins(loaded.plugins, config.searchPath, options),
      };
    }
  },

  canReuseAST({ast}) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  async parse({asset, config}) {
    // if we don't have a config it is posthtml is not configure, don't parse
    if (!config) {
      return;
    }

    return {
      type: 'posthtml',
      version: '0.4.1',
      program: parse(await asset.getCode(), {
        lowerCaseAttributeNames: true,
      }),
    };
  },

  async transform({asset, config}) {
    if (!config) {
      return [asset];
    }

    const ast = nullthrows(asset.ast);

    let res = await posthtml(config.fullyLoaded.plugins).process(
      ast.program,
      config.fullyLoaded,
    );

    if (res.messages) {
      await Promise.all(
        res.messages.map(({type, file: filePath}) => {
          if (type === 'dependency') {
            return asset.addIncludedFile({filePath});
          }
          return Promise.resolve();
        }),
      );
    }

    ast.program = res.tree;
    asset.ast = ast;

    return [asset];
  },

  generate({asset}) {
    return {
      code: render(nullthrows(asset.ast).program),
    };
  },
});
