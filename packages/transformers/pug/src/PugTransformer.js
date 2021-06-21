// @flow

import path from 'path';
import {Transformer} from '@parcel/plugin';
import pug from 'pug';

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
        config.invalidateOnStartup();
      }

      return configFile.contents;
    }
  },

  async transform({asset, config}) {
    const pugConfig = config ?? {};
    const content = await asset.getCode();
    const render = pug.compile(content, {
      compileDebug: false,
      basedir: path.dirname(asset.filePath),
      filename: asset.filePath,
      ...pugConfig,
      pretty: pugConfig.pretty || false,
    });

    for (let filePath of render.dependencies) {
      await asset.invalidateOnFileChange(filePath);
    }

    asset.type = 'html';
    asset.setCode(render(pugConfig.locals));

    return [asset];
  },
}): Transformer);
