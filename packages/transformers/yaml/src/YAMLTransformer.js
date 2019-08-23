// @flow

import {Transformer} from '@parcel/plugin';

export default new Transformer({
  async transform({asset, localRequire}) {
    const yaml = await localRequire('js-yaml', asset.filePath);
    asset.type = 'js';
    asset.setCode(
      `module.exports = ${JSON.stringify(
        yaml.safeLoad(await asset.getCode()),
        null,
        2
      )};`
    );
    return [asset];
  }
});
