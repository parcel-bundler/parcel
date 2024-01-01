// @flow

import {Transformer} from '@parcel/plugin';

import path from 'path';
import posthtml from 'posthtml';
import {parser as parse} from 'posthtml-parser';
import {render} from 'posthtml-render';
import nullthrows from 'nullthrows';
import semver from 'semver';
import loadPlugins from './loadPlugins';

export default (new Transformer({
  async loadConfig({config, options, logger}) {
    if (!config.isSource) {
      return;
    }

    let configFile = await config.getConfig(
      [
        '.posthtmlrc',
        '.posthtmlrc.js',
        '.posthtmlrc.cjs',
        '.posthtmlrc.mjs',
        'posthtml.config.js',
        'posthtml.config.cjs',
        'posthtml.config.mjs',
      ],
      {
        packageKey: 'posthtml',
      },
    );

    if (configFile) {
      let isJavascript = path.extname(configFile.filePath).endsWith('js');
      if (isJavascript) {
        // We have to invalidate on startup in case the config is non-deterministic,
        // e.g. using unknown environment variables, reading from the filesystem, etc.
        logger.warn({
          message:
            'WARNING: Using a JavaScript PostHTML config file means losing out on caching features of Parcel. Use a .posthtmlrc (JSON) file whenever possible.',
        });
      }

      // Load plugins. This must be done before adding dev dependencies so we auto install.
      let plugins = await loadPlugins(
        configFile.contents.plugins,
        config.searchPath,
        options,
      );

      // Now add dev dependencies so we invalidate when they change.
      let pluginArray = Array.isArray(configFile.contents.plugins)
        ? configFile.contents.plugins
        : Object.keys(configFile.contents.plugins);
      for (let p of pluginArray) {
        if (typeof p === 'string') {
          config.addDevDependency({
            specifier: p,
            resolveFrom: configFile.filePath,
          });
        }
      }

      configFile.contents.plugins = plugins;

      // tells posthtml that we have already called parse
      configFile.contents.skipParse = true;
      delete configFile.contents.render;

      return configFile.contents;
    }
  },

  canReuseAST({ast}) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  async parse({asset, config}) {
    // if we don't have a config it is posthtml is not configure, don't parse
    if (!config) {
      return;
    }

    return {
      type: 'posthtml',
      version: '0.4.1',
      program: parse(await asset.getCode(), {
        lowerCaseAttributeNames: true,
        sourceLocations: true,
        xmlMode: asset.type === 'xhtml',
      }),
    };
  },

  async transform({asset, config}) {
    if (!config) {
      return [asset];
    }

    let ast = nullthrows(await asset.getAST());
    let res = await posthtml(config.plugins).process(ast.program, {
      ...config,
      plugins: config.plugins,
    });

    if (res.messages) {
      for (let {type, file: filePath} of res.messages) {
        if (type === 'dependency') {
          asset.invalidateOnFileChange(filePath);
        }
      }
    }

    asset.setAST({
      type: 'posthtml',
      version: '0.4.1',
      program: JSON.parse(JSON.stringify(res.tree)), // posthtml adds functions to the AST that are not serializable
    });

    return [asset];
  },

  generate({ast, asset}) {
    return {
      content: render(ast.program, {
        closingSingleTag: asset.type === 'xhtml' ? 'slash' : undefined,
      }),
    };
  },
}): Transformer);
