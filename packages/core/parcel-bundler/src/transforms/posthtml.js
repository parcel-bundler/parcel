const loadPlugins = require('../utils/loadPlugins');
const posthtml = require('posthtml');
const posthtmlParse = require('posthtml-parser');

async function parse(code, asset) {
  var config = await getConfig(asset);
  if (!config) {
    config = {};
  }
  return posthtmlParse(code, config);
}

async function transform(asset) {
  let config = await getConfig(asset);
  if (!config) {
    return;
  }

  await asset.parseIfNeeded();
  let res = await posthtml(config.plugins).process(asset.ast, config);

  asset.ast = res.tree;
  asset.isAstDirty = true;
}

async function getConfig(asset) {
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
  config.plugins = await loadPlugins(plugins, asset.name);
  config.skipParse = true;
  return config;
}

module.exports = {parse, transform};
