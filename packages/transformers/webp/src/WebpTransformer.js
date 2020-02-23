// @flow
import {Transformer} from '@parcel/plugin';
import sharp from 'sharp';

export default new Transformer({
  async transform({asset}) {
    asset.type = 'webp';

    asset.setBuffer(
      await sharp(await asset.getBuffer())
        .webp()
        .toBuffer(),
    );

    return [asset];
  },
});
