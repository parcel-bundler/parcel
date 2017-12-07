const localRequire = require('../utils/localRequire');
const loadPlugins = require('../utils/loadPlugins');
const postcss = require('postcss');
const Config = require('../utils/config');
const cssnano = require('cssnano');
const omit = require('lodash.omit');
const get = require('lodash.get');

module.exports = async function (asset) {
  let config = await getConfig(asset);
  if (!config) {
    return;
  }

  await asset.parseIfNeeded();
  let res = await postcss(config.plugins).process(asset.getCSSAst(), config);

  asset.ast.css = res.css;
  asset.ast.dirty = false;
}

async function getConfig(asset) {
  let config = asset.package.postcss || await Config.load(asset.name, ['.postcssrc', '.postcssrc.js', 'postcss.config.js']);
  if (!config && !asset.options.minify) {
    return;
  }

  config = config || {};
  const postcssModulesConfig = Object.assign(get(config.plugins, 'postcss-modules') || {}, {
    getJSON: (filename, json) => (asset.cssModules = json)
  });
  config.plugins = loadPlugins(
    Array.isArray(config.plugins) ? config.plugins : omit(config.plugins, 'postcss-modules'),
    asset.name
  );

  if (config.modules) {
    config.plugins.push(localRequire('postcss-modules', asset.name)(postcssModulesConfig));
  }

  if (asset.options.minify) {
    config.plugins.push(cssnano());
  }

  config.from = asset.name;
  config.to = asset.name;
  return config;
}
