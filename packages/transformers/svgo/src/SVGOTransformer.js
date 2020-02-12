// @flow

import {Transformer} from '@parcel/plugin';

import SVGO from 'svgo';

const defaultConfig = {
  plugins: [{prefixIds: true}],
};

export default new Transformer({
  async getConfig({asset}) {
    let svgoConfig = await asset.getConfig(
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

    svgoConfig = svgoConfig || {};
    svgoConfig = {...defaultConfig, ...svgoConfig};

    this.svgo = new SVGO(svgoConfig);

    return svgoConfig;
  },

  transform({asset}) {
    return [asset];
  },

  async generate({asset}) {
    let code = await asset.getCode();
    let res = await this.svgo.optimize(code);

    return {code: res.data};
  },
});
