const localRequire = require('../utils/localRequire');
const loadPlugins = require('../utils/loadPlugins');
const md5 = require('../utils/md5');
const postcss = require('postcss');
const FileSystemLoader = require('css-modules-loader-core/lib/file-system-loader');
const semver = require('semver');
const path = require('path');
const fs = require('@parcel/fs');

module.exports = async function(asset) {
  let config = await getConfig(asset);
  if (!config) {
    return;
  }

  await asset.parseIfNeeded();
  let res = await postcss(config.plugins).process(asset.getCSSAst(), config);

  asset.ast.css = res.css;
  asset.ast.dirty = false;
  asset.sourceMap = res.map ? res.map.toJSON() : null;
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

  if (asset.options.sourceMaps) {
    config.map = {inline: false, annotation: false, sourcesContent: true};
  }

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
      postcssModulesConfig,
      config.plugins['postcss-modules']
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
    async fetch(composesPath, relativeTo) {
      let importPath = composesPath.replace(/^["']|["']$/g, '');
      const {resolved} = asset.resolveDependency(importPath, relativeTo);
      let rootRelativePath = path.resolve(path.dirname(relativeTo), resolved);
      const root = path.resolve('/');
      // fixes an issue on windows which is part of the css-modules-loader-core
      // see https://github.com/css-modules/css-modules-loader-core/issues/230
      if (rootRelativePath.startsWith(root)) {
        rootRelativePath = rootRelativePath.substr(root.length);
      }

      const source = await fs.readFile(resolved, 'utf-8');
      const {exportTokens} = await this.core.load(
        source,
        rootRelativePath,
        undefined,
        this.fetch.bind(this)
      );
      return exportTokens;
    }

    get finalSource() {
      return '';
    }
  };
