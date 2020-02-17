// @flow

import {Transformer} from '@parcel/plugin';

import SVGO from 'svgo';

const defaultConfig = {
  plugins: [{prefixIds: true}],
};

export default new Transformer({
  async getConfig({asset}) {
    let config = await asset.getConfig(
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

    config = {...defaultConfig, ...config};

    return config;
  },

  async transform({asset, config}) {
    let code = await asset.getCode();
    let svgo = new SVGO(config);
    let res = await svgo.optimize(code);

    asset.setCode(res.data);

    return [asset];
  },
});
