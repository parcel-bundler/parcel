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
  if (!config && !asset.options.minify) {
    return;
  }

  config = config || {};
  const plugins = config.plugins;
  if (typeof plugins === 'object') {
    // This is deprecated in favor of result messages but kept for compatibility
    // See https://github.com/posthtml/posthtml-include/blob/e4f2a57c2e52ff721eed747b65eddf7d7a1451e3/index.js#L18-L26
    const depConfig = {
      addDependencyTo: {
        addDependency: name =>
          asset.addDependency(name, {includedInParent: true})
      }
    };
    Object.keys(plugins).forEach(p => Object.assign(plugins[p], depConfig));
  }
  // TODO: find a way to load plugins
  // config.plugins = await loadPlugins(plugins, asset.name);
  config.skipParse = true;
  return config;
};

export default new Transformer({
  async getConfig(asset) {
    return getPostHTMLConfig(asset);
  },

  canReuseAST(ast) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  async parse(asset, config) {
    return {
      type: 'posthtml',
      version: '0.4.1',
      program: parse(await asset.getCode(), config)
    };
  },

  async transform(asset, config) {
    await asset.parseIfNeeded();

    let res = await posthtml(config.plugins).process(asset.ast, config);

    asset.ast = res.tree;
    asset.isAstDirty = true;

    return [asset];
  },

  generate(asset) {
    return {
      code: render(nullthrows(asset.ast).program)
    };
  }
});
