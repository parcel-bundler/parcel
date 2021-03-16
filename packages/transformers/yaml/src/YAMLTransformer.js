// @flow

import {Transformer} from '@parcel/plugin';
import yaml from 'js-yaml';

export default (new Transformer({
  async transform({asset}) {
    asset.type = 'js';
    asset.setCode(
      `module.exports = ${JSON.stringify(
        yaml.load(await asset.getCode()),
        null,
        2,
      )};`,
    );
    return [asset];
  },
}): Transformer);
