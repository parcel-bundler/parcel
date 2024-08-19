// @flow

import {Transformer} from '@atlaspack/plugin';
import postcss from 'postcss';
import sugarss from 'sugarss';

export default (new Transformer({
  async transform({asset}) {
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
}): Transformer);
