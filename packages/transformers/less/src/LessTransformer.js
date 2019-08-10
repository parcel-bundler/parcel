// @flow

import {Transformer} from '@parcel/plugin';
import localRequire from '@parcel/local-require';
import {isGlob, glob} from '@parcel/utils';

export default new Transformer({
  async getConfig({asset}) {
    return asset.getConfig(['.lessrc', '.lessrc.js'], {
      packageKey: 'less'
    });
  },

  async transform({asset, config}) {
    const less = await localRequire('less', asset.filePath);
    const code = await asset.getCode();
    const output = await less.render(code, {
      ...config,
      filename: asset.filePath
    });

    asset.type = 'css';
    asset.setCode(output.css);
    return [asset];
  }
});
