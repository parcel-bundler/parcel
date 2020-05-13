// @flow

import {Transformer} from '@parcel/plugin';

export default new Transformer({
  async transform({asset, options}) {
    const yaml = await options.packageManager.require(
      'js-yaml',
      asset.filePath,
      {autoinstall: options.autoinstall},
    );
    asset.type = 'js';
    asset.setCode(
      `module.exports = ${JSON.stringify(
        yaml.safeLoad(await asset.getCode()),
        null,
        2,
      )};`,
    );
    return [asset];
  },
});
