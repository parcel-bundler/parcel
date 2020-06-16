// @flow

import path from 'path';
import {Transformer} from '@parcel/plugin';

export default new Transformer({
  async loadConfig({config}) {
    let configFile = await config.getConfig([
      '.pugrc',
      '.pugrc.js',
      'pug.config.js',
    ]);

    // Don't cache JS configs...
    if (configFile && path.extname(configFile.filePath) === '.js') {
      config.shouldInvalidateOnStartup();
    }
  },

  async transform({asset, config, options}) {
    if (!config) {
      return [asset];
    }

    const pug = await options.packageManager.require('pug', asset.filePath, {
      autoinstall: options.autoinstall,
    });
    const content = await asset.getCode();
    const render = pug.compile(content, {
      degug: true,
      compileDebug: false,
      basedir: path.dirname(asset.filePath),
      filename: asset.filePath,
      pretty: config.pretty || false,
      doctype: config.doctype,
      filters: config.filters,
      filterOptions: config.filterOptions,
      filterAliases: config.filterAliases,
    });

    for (let filePath of render.dependencies) {
      await asset.addIncludedFile({filePath});
    }

    asset.type = 'html';
    asset.setCode(render(config.locals));

    return [asset];
  },
});
