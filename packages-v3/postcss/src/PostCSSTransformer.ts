import {Transformer} from '@parcel/plugin';
import type {AcceptedPlugin} from 'postcss';
import postcss from 'postcss';
import json5 from 'json5';
import path from 'path';
import fs from 'fs';
import {createRequire} from 'module';

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

type Config = {
  plugins?: Array<string | AcceptedPlugin> | Record<string, unknown>;
};

export default new Transformer<Config | undefined>({
  async transform({asset, config, options}) {
    // Config from .parcelrc takes precedence. Plugin names are resolved
    // relative to the asset since the .parcelrc location isn't known here.
    let resolveFrom = asset.filePath;
    if (config == null) {
      if (!asset.isSource) {
        return;
      }

      let configFile = await findConfig(
        path.dirname(asset.filePath),
        options.projectRoot,
      );
      if (!configFile) {
        return;
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
    let result = await postcss(plugins).process(asset.getCode(), {
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
    // source-map-js types the version as a string, but it is always 3.
    asset.setCode(
      result.css,
      result.map ? {...result.map.toJSON(), version: 3} : null,
    );
  },
});

async function findConfig(
  dir: string,
  projectRoot: string,
): Promise<{filePath: string; contents: Config} | null> {
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

function exists(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function loadConfigFile(filePath: string): Promise<Config> {
  let ext = path.extname(filePath);
  if (ext === '.mjs') {
    let mod = await import(filePath);
    return mod.default;
  }

  if (ext === '.js' || ext === '.cjs') {
    let mod = require(filePath);
    return mod?.__esModule ? mod.default : mod;
  }

  let code = fs.readFileSync(filePath, 'utf8');
  try {
    return json5.parse(code);
  } catch (err: any) {
    // Shape the error so it is reported with a code frame in the config file.
    let error = new Error(err.message);
    Object.assign(error, {
      filename: filePath,
      line: err.lineNumber,
      column: err.columnNumber,
    });
    throw error;
  }
}

async function loadPlugins(
  plugins: NonNullable<Config['plugins']>,
  resolveFrom: string,
): Promise<Array<AcceptedPlugin>> {
  let loaded = Array.isArray(plugins)
    ? await Promise.all(plugins.map(p => loadPlugin(p, null, resolveFrom)))
    : await Promise.all(
        Object.keys(plugins).map(p => loadPlugin(p, plugins[p], resolveFrom)),
      );
  return loaded.filter((p): p is AcceptedPlugin => !!p);
}

async function loadPlugin(
  plugin: string | AcceptedPlugin,
  pluginOptions: unknown,
  resolveFrom: string,
): Promise<AcceptedPlugin | null> {
  if (typeof plugin !== 'string') {
    return plugin;
  }

  // Plugins are Node packages, so resolve them with Node semantics from the config.
  let mod = createRequire(resolveFrom)(plugin);
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
