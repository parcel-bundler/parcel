// @flow

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async transform({asset, options}) {
    const yaml = await options.packageManager.require(
      'js-yaml',
      asset.filePath,
      {shouldAutoInstall: options.shouldAutoInstall, range: '^4.0.0'},
    );
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
