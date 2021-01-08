// @flow

import path from 'path';
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async loadConfig({config}) {
    let configFile = await config.getConfig([
      '.pugrc',
      '.pugrc.js',
      'pug.config.js',
    ]);

    if (configFile) {
      let isJavascript = path.extname(configFile.filePath) === '.js';
      if (isJavascript) {
        config.shouldInvalidateOnStartup();
        config.shouldReload();
      }

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

  async transform({asset, config, options}) {
    const pugConfig = config ? config.contents : {};
    const pug = await options.packageManager.require('pug', asset.filePath, {
      shouldAutoInstall: options.shouldAutoInstall,
    });
    const content = await asset.getCode();
    const render = pug.compile(content, {
      compileDebug: false,
      basedir: path.dirname(asset.filePath),
      filename: asset.filePath,
      ...pugConfig,
      pretty: pugConfig.pretty || false,
    });

    for (let filePath of render.dependencies) {
      await asset.addIncludedFile(filePath);
    }

    asset.type = 'html';
    asset.setCode(render(pugConfig.locals));

    return [asset];
  },
}): Transformer);
