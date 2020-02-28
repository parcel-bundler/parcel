// @flow
import {Transformer} from '@parcel/plugin';
import sharp from 'sharp';

export default new Transformer({
  async transform({asset}) {
    let inputBuffer = await asset.getBuffer();
    let width = asset.query.width ? parseInt(asset.query.width, 10) : null;
    let height = asset.query.height ? parseInt(asset.query.height, 10) : null;
    let format = asset.query.as ? asset.query.as.trim() : null;

    let imagePipeline = sharp(inputBuffer);
    if (width || height) {
      imagePipeline.resize(width, height);
    }

    if (format) {
      if (!imagePipeline[format]) {
        throw new Error(`Sharp does not support ${format} images.`);
      }

      asset.type = format;

      imagePipeline[format]();
    }

    asset.setStream(imagePipeline);

    return [asset];
  },
});
