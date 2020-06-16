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

    if (configFile) {
      // Don't cache JS configs
      let isJavaScript = path.extname(configFile.filePath) === '.js';
      if (isJavaScript) {
        config.shouldInvalidateOnStartup();

        // Check if we can cache this at all
        // should fail with advanced data types like functions and maps
        try {
          JSON.stringify(configFile.contents);
        } catch (e) {
          config.shouldReload();
        }
      }

      config.setResult({contents: configFile.contents, isJavaScript});
    }
  },

  preSerializeConfig({config}) {
    if (!config.result) return;

    // Ensure we dont try to serialise functions
    if (config.result.isJavaScript) {
      config.result.contents = {};
    }
  },

  async transform({asset, config, options}) {
    const pugConfig = config ? config.contents : {};
    const pug = await options.packageManager.require('pug', asset.filePath, {
      autoinstall: options.autoinstall,
    });
    const content = await asset.getCode();
    const render = pug.compile(content, {
      degug: true,
      compileDebug: false,
      basedir: path.dirname(asset.filePath),
      filename: asset.filePath,
      pretty: pugConfig.pretty || false,
      doctype: pugConfig.doctype,
      filters: pugConfig.filters,
      filterOptions: pugConfig.filterOptions,
      filterAliases: pugConfig.filterAliases,
    });

    for (let filePath of render.dependencies) {
      await asset.addIncludedFile({filePath});
    }

    asset.type = 'html';
    asset.setCode(render(pugConfig.locals));

    return [asset];
  },
});
