// @flow

import path from 'path';
import {Transformer} from '@parcel/plugin';

export default new Transformer({
  async getConfig({asset}) {
    const config =
      (await asset.getConfig(['.pugrc', '.pugrc.js', 'pug.config.js'])) || {};
    return config;
  },

  async transform({asset, config, options}) {
    if (!config) {
      return [asset];
    }

    const pug = await options.packageManager.require('pug', asset.filePath);
    const html = pug.compileFile(asset.filePath, {
      degug: true,
      compileDebug: false,
      filename: path.basename(asset.filePath),
      pretty: config.pretty || false,
      doctype: config.doctype,
      filters: config.filters,
      filterOptions: config.filterOptions,
      filterAliases: config.filterAliases
    })(config.locals);

    asset.type = 'html';
    asset.setCode(html);

    return [asset];
  }
});
