// @flow

import {Transformer} from '@parcel/plugin';
import postcss from 'postcss';

export default new Transformer({
  async transform({asset, options}) {
    const sugarss = await options.packageManager.require(
      'sugarss',
      asset.filePath,
      {autoinstall: options.autoinstall},
    );
    const code = await asset.getCode();
    const {css} = await postcss().process(code, {
      from: asset.filePath,
      to: asset.filePath,
      parser: sugarss,
    });
    asset.type = 'css';
    asset.setCode(css);
    return [asset];
  },
});
