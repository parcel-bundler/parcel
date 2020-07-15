// @flow

import {Transformer} from '@parcel/plugin';

import SVGO from 'svgo';
import path from 'path';

const defaultConfig = {
  plugins: [{prefixIds: true}],
};

export default (new Transformer({
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

  async transform({asset, config}) {
    let svgoConfig = config ? config.contents : {};
    let code = await asset.getCode();
    let svgo = new SVGO({...defaultConfig, ...svgoConfig});
    let res = await svgo.optimize(code, {path: asset.id});

    asset.setCode(res.data);

    return [asset];
  },
}): Transformer);
