// @flow

import {Transformer} from '@parcel/plugin';

import posthtml from 'posthtml';
import parse from 'posthtml-parser';
import render from 'posthtml-render';
import nullthrows from 'nullthrows';
import semver from 'semver';
import loadPlugins from './loadPlugins';

export default new Transformer({
  async loadConfig({config, options}) {
    let configResult = await config.getConfig(
      ['.posthtmlrc', '.posthtmlrc.js', 'posthtml.config.js'],
      options
    );

    configResult = configResult || {};
    configResult.skipParse = true;

    // if (canSerializeConfig(config)) {
    //   config.shouldReload();
    //   config.setResult({
    //     internal: false
    //   });
    //   config.setResultHash(JSON.stringify(Date.now()));
    // }

    if (configResult.plugins) {
      config.shouldRehydrate();
    }

    config.setResult(configResult);
  },

  async rehydrateConfig({config, options}) {
    let configResult = config.result;

    // convert plugins from config to functions
    configResult.plugins = await loadPlugins(
      configResult.plugins,
      config.searchPath,
      options
    );
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
        lowerCaseAttributeNames: true
      })
    };
  },

  async transform({asset, config}) {
    if (!config) {
      return [asset];
    }

    const ast = nullthrows(asset.ast);

    let res = await posthtml(config.plugins).process(ast.program, config);

    if (res.messages) {
      await Promise.all(
        res.messages.map(({type, file: filePath}) => {
          if (type === 'dependency') {
            return asset.addIncludedFile({filePath});
          }
          return Promise.resolve();
        })
      );
    }

    ast.program = res.tree;
    asset.ast = ast;

    return [asset];
  },

  generate({asset}) {
    return {
      code: render(nullthrows(asset.ast).program)
    };
  }
});
