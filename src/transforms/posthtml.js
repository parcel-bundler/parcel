const loadPlugins = require('../utils/loadPlugins');
const posthtml = require('posthtml');
const Config = require('../utils/config');
const htmlnano = require('htmlnano');

async function parse(asset) {
  await getConfig(asset);
  if (!asset.config.posthtml) {
    return;
  }

  await asset.parseIfNeeded();
  let res = await posthtml(asset.config.posthtml.plugins).process(
    asset.ast,
    asset.config.posthtml
  );

  asset.ast = res.tree;
  asset.isAstDirty = true;
}

async function getConfig(asset) {
  if (asset.config.posthtml) {
    return asset.config;
  }

  asset.config.posthtml =
    asset.package.posthtml ||
    (await Config.load(asset.name, [
      '.posthtmlrc',
      '.posthtmlrc.js',
      'posthtml.config.js'
    ]));
  if (!asset.config.posthtml && !asset.options.minify) {
    return;
  }

  asset.config.posthtml = asset.config.posthtml || {};
  asset.config.posthtml.plugins = loadPlugins(
    asset.config.posthtml.plugins,
    asset.name
  );

  if (asset.options.minify) {
    asset.config.posthtml.plugins.push(htmlnano());
  }

  asset.config.posthtml.skipParse = true;

  return asset.config;
}

module.exports.getConfig = getConfig;
module.exports.parse = parse;
