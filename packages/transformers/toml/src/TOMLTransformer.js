// @flow

import {Transformer} from '@parcel/plugin';
import toml from '@iarna/toml';

export default (new Transformer({
  async transform({asset}) {
    asset.type = 'js';
    asset.setCode(
      `module.exports = ${JSON.stringify(
        toml.parse(await asset.getCode()),
        null,
        2,
      )};`,
    );
    return [asset];
  },
}): Transformer);
