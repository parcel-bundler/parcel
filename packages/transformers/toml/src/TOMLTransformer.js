// @flow

import {Transformer} from '@parcel/plugin';
import localRequire from '@parcel/local-require';

export default new Transformer({
  async transform({asset}) {
    const toml = await localRequire('@iarna/toml', asset.filePath);
    asset.type = 'js';
    asset.setCode(
      `module.exports = ${JSON.stringify(
        toml.parse(await asset.getCode()),
        null,
        2
      )};`
    );
    return [asset];
  }
});
