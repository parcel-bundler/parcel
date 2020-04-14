// @flow

import {Transformer} from '@parcel/plugin';
import json5 from 'json5';

export default new Transformer({
  generate({ast}) {
    return {
      content: JSON.stringify(ast.program),
    };
  },

  async transform({asset}) {
    asset.setAST({
      type: 'json',
      version: '0.0.0',
      program: json5.parse(await asset.getCode()),
    });
    asset.type = 'json';

    return [asset];
  },
});
