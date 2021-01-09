// @flow

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async transform({asset, options}) {
    const toml = await options.packageManager.require(
      '@iarna/toml',
      asset.filePath,
      {shouldAutoInstall: options.shouldAutoInstall},
    );
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
