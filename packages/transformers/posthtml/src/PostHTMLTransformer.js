// @flow

import {Transformer} from '@parcel/plugin';

import path from 'path';
import posthtml from 'posthtml';
import parse from 'posthtml-parser';
import render from 'posthtml-render';
import nullthrows from 'nullthrows';
import semver from 'semver';
import loadPlugins from './loadPlugins';

export default (new Transformer({
  async loadConfig({config}) {
    let configFile = await config.getConfig(
      ['.posthtmlrc', '.posthtmlrc.js', 'posthtml.config.js'],
      {
        packageKey: 'posthtml',
      },
    );

    if (configFile) {
      let isJavascript = path.extname(configFile.filePath) === '.js';
      if (isJavascript) {
        config.shouldInvalidateOnStartup();
        config.shouldReload();
      }

      // tells posthtml that we have already called parse
      configFile.contents.skipParse = true;
      delete configFile.contents.render;

      config.setResult({
        contents: configFile.contents,
        isSerialisable: !isJavascript,
      });
    }
  },

  preSerializeConfig({config}) {
    if (!config.result) return;

    // Ensure we dont try to serialise functions
    if (!config.result.isSerialisable) {
      config.result.contents = {};
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
      }),
    };
  },

  async transform({asset, config, options}) {
    if (!config) {
      return [asset];
    }

    // load plugins
    const plugins = await loadPlugins(
      config.contents.plugins,
      asset.filePath,
      options,
    );

    let ast = nullthrows(await asset.getAST());
    let res = await posthtml(plugins).process(ast.program, {
      ...config.contents,
      plugins,
    });

    if (res.messages) {
      await Promise.all(
        res.messages.map(({type, file: filePath}) => {
          if (type === 'dependency') {
            return asset.addIncludedFile(filePath);
          }
          return Promise.resolve();
        }),
      );
    }

    asset.setAST({
      type: 'posthtml',
      version: '0.4.1',
      program: JSON.parse(JSON.stringify(res.tree)), // posthtml adds functions to the AST that are not serializable
    });

    return [asset];
  },

  generate({ast}) {
    return {
      content: render(ast.program),
    };
  },
}): Transformer);
