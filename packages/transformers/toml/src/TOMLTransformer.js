// @flow

import {Transformer} from '@parcel/plugin';

export default new Transformer({
  async transform({asset, localRequire}) {
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
