const localRequire = require('../utils/localRequire');
const loadPlugins = require('../utils/loadPlugins');
const md5 = require('../utils/md5');
const postcss = require('postcss');
const FileSystemLoader = require('css-modules-loader-core/lib/file-system-loader');
const semver = require('semver');

module.exports = async function(asset) {
  let config = await getConfig(asset);
  if (!config) {
    return;
  }

  await asset.parseIfNeeded();
  let res = await postcss(config.plugins).process(asset.getCSSAst(), config);

  asset.ast.css = res.css;
  asset.ast.dirty = false;
};

async function getConfig(asset) {
  let config = await asset.getConfig(
    ['.postcssrc', '.postcssrc.json', '.postcssrc.js', 'postcss.config.js'],
    {packageKey: 'postcss'}
  );

  let enableModules =
    asset.options.rendition && asset.options.rendition.modules;
  if (!config && !asset.options.minify && !enableModules) {
    return;
  }

  config = config || {};

  if (typeof config !== 'object') {
    throw new Error('PostCSS config should be an object.');
  }

  let postcssModulesConfig = {
    getJSON: (filename, json) => (asset.cssModules = json),
    Loader: createLoader(asset),
    generateScopedName: (name, filename) =>
      `_${name}_${md5(filename).substr(0, 5)}`
  };

  if (config.plugins && config.plugins['postcss-modules']) {
    postcssModulesConfig = Object.assign(
      config.plugins['postcss-modules'],
      postcssModulesConfig
    );
    delete config.plugins['postcss-modules'];
  }

  config.plugins = await loadPlugins(config.plugins, asset.name);

  if (config.modules || enableModules) {
    let postcssModules = await localRequire('postcss-modules', asset.name);
    config.plugins.push(postcssModules(postcssModulesConfig));
  }

  if (asset.options.minify) {
    let cssnano = await localRequire('cssnano', asset.name);
    let {version} = await localRequire('cssnano/package.json', asset.name);
    config.plugins.push(
      cssnano(
        (await asset.getConfig(['cssnano.config.js'])) || {
          // Only enable safe css transforms if cssnano < 4
          // See: https://github.com/parcel-bundler/parcel/issues/698
          // See: https://github.com/ben-eb/cssnano/releases/tag/v4.0.0-rc.0
          safe: semver.satisfies(version, '<4.0.0-rc')
        }
      )
    );
  }

  config.from = asset.name;
  config.to = asset.name;
  return config;
}

const createLoader = asset =>
  class ParcelFileSystemLoader extends FileSystemLoader {
    async fetch(composesPath, relativeTo, trace) {
      let importPath = composesPath.replace(/^["']|["']$/g, '');
      const {resolved} = asset.resolveDependency(importPath, relativeTo);
      return FileSystemLoader.prototype.fetch.call(
        this,
        resolved,
        relativeTo,
        trace
      );
    }
    get finalSource() {
      return '';
    }
  };
