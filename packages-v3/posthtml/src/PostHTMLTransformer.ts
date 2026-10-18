import {Transformer} from '@parcel/plugin';
import posthtml from 'posthtml';
import path from 'path';
import fs from 'fs';
import {createRequire} from 'module';

type Plugin = posthtml.Plugin<unknown>;

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

type Config = {
  plugins?: Array<string | Plugin> | Record<string, unknown>;
  [option: string]: unknown;
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

    let plugins = await loadPlugins(config.plugins, resolveFrom);
    let {render, ...rest} = config;

    // posthtml's Options type is missing the parser options passed through to htmlparser2.
    let processOptions: posthtml.Options & Record<string, unknown> = {
      ...rest,
      plugins,
      xmlMode: asset.type === 'xhtml',
      closingSingleTag: asset.type === 'xhtml' ? 'slash' : undefined,
    };

    let res = await posthtml(plugins).process(asset.getCode(), processOptions);

    asset.setCode(res.html);
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

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function loadPlugins(
  plugins: Config['plugins'],
  resolveFrom: string,
): Promise<Array<Plugin>> {
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

async function loadPlugin(
  plugin: string | Plugin,
  pluginOptions: unknown,
  resolveFrom: string,
): Promise<Plugin> {
  if (typeof plugin !== 'string') {
    return plugin;
  }

  // Plugins are Node packages, so resolve them with Node semantics from the config.
  let mod = createRequire(resolveFrom)(plugin);
  mod = mod.default || mod;
  return mod(pluginOptions);
}
