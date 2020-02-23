// @flow
import {Transformer} from '@parcel/plugin';
import sharp from 'sharp';

export default new Transformer({
  async transform({asset}) {
    if (asset.query.width || asset.query.height) {
      let inputBuffer = await asset.getBuffer();
      let width = asset.query.width ? parseInt(asset.query.width, 10) : null;
      let height = asset.query.height ? parseInt(asset.query.height, 10) : null;
      asset.setBuffer(
        await sharp(inputBuffer)
          .resize(width, height)
          .toBuffer(),
      );
    }

    return [asset];
  },
});
