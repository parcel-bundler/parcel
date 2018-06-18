const loadPlugins = require('../utils/loadPlugins');
const posthtml = require('posthtml');
const posthtmlParse = require('posthtml-parser');

async function parse(code, asset) {
  var config = await getConfig(asset);
  if (!config) {
    config = {};
  }
  config = Object.assign({lowerCaseAttributeNames: true}, config);
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

  config = Object.assign({}, config);
  const plugins = config.plugins;
  if (typeof plugins === 'object') {
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
