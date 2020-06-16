// @flow

import {Transformer} from '@parcel/plugin';

import SVGO from 'svgo';
import path from 'path';

const defaultConfig = {
  plugins: [{prefixIds: true}],
};

export default new Transformer({
  async loadConfig({config}) {
    let configFile = await config.getConfig(
      [
        '.svgorc',
        '.svgorc.json',
        '.svgorc.yaml',
        '.svgorc.yml',
        'svgo.config.js',
        '.svgo.yml',
      ],
      {
        packageKey: 'svgo',
      },
    );

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

  async transform({asset, config}) {
    let svgoConfig = config ? config.contents : {};
    let code = await asset.getCode();
    let svgo = new SVGO({...defaultConfig, ...svgoConfig});
    let res = await svgo.optimize(code);

    asset.setCode(res.data);

    return [asset];
  },
});
