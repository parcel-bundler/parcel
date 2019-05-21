// @flow

import {Transformer} from '@parcel/plugin';

import posthtml from 'posthtml';
import parse from 'posthtml-parser';
import render from 'posthtml-render';
import nullthrows from 'nullthrows';
import semver from 'semver';

const getPostHTMLConfig = async asset => {
  let config = await asset.getConfig(
    ['.posthtmlrc', '.posthtmlrc.js', 'posthtml.config.js'],
    {
      packageKey: 'posthtml'
    }
  );

  config = config || {};
  const plugins = config.plugins;

  // TODO: find a way to load plugins
  // config.plugins = await loadPlugins(plugins, asset.name);
  config.skipParse = true;
  return config;
};

export default new Transformer({
  async getConfig({asset}) {
    return getPostHTMLConfig(asset);
  },

  canReuseAST({ast}) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  async parse({asset, config}) {
    return {
      type: 'posthtml',
      version: '0.4.1',
      program: parse(await asset.getCode(), config)
    };
  },

  async transform({asset, config}) {
    if (!config) {
      return [asset];
    }

    let res = await posthtml(config.plugins).process(asset.ast, config);

    asset.ast = res.tree;
    asset.isAstDirty = true;

    return [asset];
  },

  generate({asset}) {
    return {
      code: render(nullthrows(asset.ast).program)
    };
  }
});
