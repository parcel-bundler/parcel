const localRequire = require('../utils/localRequire');
const install = require('../utils/installPackage');
const loadPlugins = require('../utils/loadPlugins');
const postcss = require('postcss');
const cssnano = require('cssnano');

async function process(asset) {
  let config = await getConfig(asset);
  if (!config) {
    return;
  }

  await asset.parseIfNeeded();
  let res = await postcss(config.plugins).process(asset.getCSSAst(), config);

  asset.ast.css = res.css;
  asset.ast.dirty = false;
}

async function getConfig(asset, installPlugins = false) {
  let config =
    asset.package.postcss ||
    (await asset.getConfig([
      '.postcssrc',
      '.postcssrc.js',
      'postcss.config.js'
    ]));
  if (!config && !asset.options.minify) {
    return;
  }

  config = config || {};

  let postcssModulesConfig = {
    getJSON: (filename, json) => (asset.cssModules = json)
  };

  if (config.plugins && config.plugins['postcss-modules']) {
    postcssModulesConfig = Object.assign(
      config.plugins['postcss-modules'],
      postcssModulesConfig
    );
    delete config.plugins['postcss-modules'];
  }

  config.plugins = await loadPlugins(
    config.plugins,
    asset.name,
    installPlugins
  );

  if (config.modules) {
    if (installPlugins) {
      await install(['postcss-modules'], asset.name);
    }
    let postcssModules = localRequire('postcss-modules', asset.name);
    config.plugins.push(postcssModules(postcssModulesConfig));
  }

  if (asset.options.minify) {
    config.plugins.push(
      cssnano(
        (await asset.getConfig(['cssnano.config.js'])) || {
          // Only enable safe css transforms by default.
          // See: https://github.com/parcel-bundler/parcel/issues/698
          // Note: Remove when upgrading cssnano to v4
          // See: https://github.com/ben-eb/cssnano/releases/tag/v4.0.0-rc.0
          safe: true
        }
      )
    );
  }

  config.from = asset.name;
  config.to = asset.name;
  return config;
}

module.exports = process;
module.exports.getConfig = getConfig;
