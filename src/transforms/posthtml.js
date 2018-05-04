const loadPlugins = require('../utils/loadPlugins');
const posthtml = require('posthtml');

module.exports = async function(asset) {
  let config = await getConfig(asset);
  if (!config) {
    return;
  }

  await asset.parseIfNeeded();
  let res = await posthtml(config.plugins).process(asset.ast, config);

  asset.ast = res.tree;
  asset.isAstDirty = true;
};

async function getConfig(asset) {
  let config =
    asset.package.posthtml ||
    (await asset.getConfig([
      '.posthtmlrc',
      '.posthtmlrc.js',
      'posthtml.config.js'
    ]));
  if (!config && !asset.options.minify) {
    return;
  }

  config = Object.assign({}, config);
  config.plugins = await loadPlugins(config.plugins, asset.name);
  config.skipParse = true;
  return config;
}
