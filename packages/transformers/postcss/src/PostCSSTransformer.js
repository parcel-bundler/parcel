// @flow

import {Transformer} from '@parcel/plugin';
import postcss from 'postcss';
import json5 from 'json5';
import path from 'path';
import fs from 'fs';

const CONFIG_FILES = [
  '.postcssrc',
  '.postcssrc.json',
  '.postcssrc.js',
  '.postcssrc.cjs',
  '.postcssrc.mjs',
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
];

export default (new Transformer({
  async transform({asset, config, options}) {
    // Config from .parcelrc takes precedence. Plugin names are resolved
    // relative to the asset since the .parcelrc location isn't known here.
    let resolveFrom = asset.filePath;
    if (config == null) {
      if (!asset.isSource) {
        return [asset];
      }

      let configFile = await findConfig(
        path.dirname(asset.filePath),
        options.projectRoot,
      );
      if (!configFile) {
        return [asset];
      }

      config = configFile.contents;
      resolveFrom = configFile.filePath;
    }

    if (config == null || typeof config !== 'object') {
      throw new Error('PostCSS config should be an object.');
    }

    if (
      config.plugins == null ||
      typeof config.plugins !== 'object' ||
      Object.keys(config.plugins).length === 0
    ) {
      throw new Error('PostCSS config must have plugins');
    }

    let plugins = await loadPlugins(config.plugins, resolveFrom);
    let result = await postcss(plugins).process(await asset.getCode(), {
      from: asset.filePath,
      to: asset.filePath,
      map: asset.target.sourceMap
        ? {
            inline: false,
            annotation: false,
            sourcesContent: true,
            prev: asset.getMap() ?? false,
          }
        : false,
    });

    asset.type = 'css';
    asset.setCode(result.css, result.map ? result.map.toJSON() : null);
    return [asset];
  },
}): Transformer);

async function findConfig(dir, projectRoot) {
  for (;;) {
    for (let name of CONFIG_FILES) {
      let filePath = path.join(dir, name);
      if (!exists(filePath)) {
        continue;
      }

      return {filePath, contents: await loadConfigFile(filePath)};
    }

    let pkgPath = path.join(dir, 'package.json');
    if (exists(pkgPath)) {
      let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.postcss != null) {
        return {filePath: pkgPath, contents: pkg.postcss};
      }
    }

    let parent = path.dirname(dir);
    if (dir === projectRoot || parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function exists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function loadConfigFile(filePath) {
  let ext = path.extname(filePath);
  if (ext === '.mjs') {
    let mod = await import(filePath);
    return mod.default;
  }

  if (ext === '.js' || ext === '.cjs') {
    // $FlowFixMe
    let mod = require(filePath);
    return mod?.__esModule ? mod.default : mod;
  }

  let code = fs.readFileSync(filePath, 'utf8');
  try {
    return json5.parse(code);
  } catch (err) {
    // Shape the error so it is reported with a code frame in the config file.
    let error = new Error(err.message);
    // $FlowFixMe
    Object.assign(error, {
      filename: filePath,
      line: err.lineNumber,
      column: err.columnNumber,
    });
    throw error;
  }
}

async function loadPlugins(plugins, resolveFrom) {
  let loaded = Array.isArray(plugins)
    ? await Promise.all(plugins.map(p => loadPlugin(p, null, resolveFrom)))
    : await Promise.all(
        Object.keys(plugins).map(p => loadPlugin(p, plugins[p], resolveFrom)),
      );
  return loaded.filter(Boolean);
}

async function loadPlugin(plugin, pluginOptions, resolveFrom) {
  if (typeof plugin !== 'string') {
    return plugin;
  }

  // Plugins are Node packages, so resolve them with Node semantics from the config.
  // $FlowFixMe
  let resolved = require.resolve(plugin, {paths: [path.dirname(resolveFrom)]});
  // $FlowFixMe
  let mod = require(resolved);
  mod = mod.default || mod;

  // Plugins without options are passed uncalled; postcss invokes creators itself.
  if (
    pluginOptions != null &&
    typeof pluginOptions === 'object' &&
    Object.keys(pluginOptions).length > 0
  ) {
    mod = mod(pluginOptions);
  }

  return mod.default || mod;
}
