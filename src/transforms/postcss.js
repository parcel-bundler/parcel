const localRequire = require('../utils/localRequire');
const loadPlugins = require('../utils/loadPlugins');
const postcss = require('postcss');
const Config = require('../utils/config');
const cssnano = require('cssnano');

async function parse(asset) {
  await getConfig(asset);
  if (!asset.config.postcss) {
    return;
  }

  await asset.parseIfNeeded();
  let res = await postcss(asset.config.postcss.plugins).process(
    asset.getCSSAst(),
    asset.config.postcss
  );

  asset.ast.css = res.css;
  asset.ast.dirty = false;
}

async function getConfig(asset) {
  if (asset.config.postcss) {
    return asset.config;
  }

  asset.config.postcss =
    asset.package.postcss ||
    (await Config.load(asset.name, [
      '.postcssrc',
      '.postcssrc.js',
      'postcss.config.js'
    ]));
  if (!asset.config.postcss && !asset.options.minify) {
    return;
  }

  asset.config.postcss = asset.config.postcss || {};

  let postcssModulesConfig = {
    getJSON: (filename, json) => (asset.cssModules = json)
  };

  if (
    asset.config.postcss.plugins &&
    asset.config.postcss.plugins['postcss-modules']
  ) {
    postcssModulesConfig = Object.assign(
      asset.config.postcss.plugins['postcss-modules'],
      postcssModulesConfig
    );
    delete asset.config.postcss.plugins['postcss-modules'];
  }

  asset.config.postcss.plugins = loadPlugins(
    asset.config.postcss.plugins,
    asset.name
  );

  if (asset.config.postcss.modules) {
    asset.config.postcss.plugins.push(
      localRequire('postcss-modules', asset.name)(postcssModulesConfig)
    );
  }

  if (asset.options.minify) {
    asset.config.postcss.plugins.push(cssnano());
  }

  asset.config.postcss.from = asset.name;
  asset.config.postcss.to = asset.name;

  return asset.config;
}

module.exports.getConfig = getConfig;
module.exports.parse = parse;
