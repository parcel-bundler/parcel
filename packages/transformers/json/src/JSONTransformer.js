// @flow

import {Transformer} from '@parcel/plugin';
import json5 from 'json5';

export default new Transformer({
  async transform({asset}) {
    asset.type = 'js';
    asset.setCode(
      `module.exports = ${JSON.stringify(
        json5.parse(await asset.getCode()),
        null,
        2
      )};`
    );
    return [asset];
  }
});
