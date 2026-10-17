// @flow

import {Transformer} from '@parcel/plugin';
import posthtml from 'posthtml';
import path from 'path';
import fs from 'fs';

const CONFIG_FILES = [
  '.posthtmlrc',
  '.posthtmlrc.json',
  '.posthtmlrc.js',
  '.posthtmlrc.cjs',
  '.posthtmlrc.mjs',
  'posthtml.config.js',
  'posthtml.config.cjs',
  'posthtml.config.mjs',
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

    let plugins = await loadPlugins(config.plugins, resolveFrom);
    let {render, ...processOptions} = config;

    let res = await posthtml(plugins).process(await asset.getCode(), {
      ...processOptions,
      plugins,
      xmlMode: asset.type === 'xhtml',
      closingSingleTag: asset.type === 'xhtml' ? 'slash' : undefined,
    });

    asset.setCode(res.html);
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
      if (pkg.posthtml != null) {
        return {filePath: pkgPath, contents: pkg.posthtml};
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

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function loadPlugins(plugins, resolveFrom) {
  if (Array.isArray(plugins)) {
    return Promise.all(plugins.map(p => loadPlugin(p, null, resolveFrom)));
  }

  if (plugins != null && typeof plugins === 'object') {
    return Promise.all(
      Object.keys(plugins).map(p => loadPlugin(p, plugins[p], resolveFrom)),
    );
  }

  return [];
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
  return mod(pluginOptions);
}
