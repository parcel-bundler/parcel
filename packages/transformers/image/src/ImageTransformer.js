// @flow
import {Transformer} from '@parcel/plugin';
import sharp from 'sharp';

// from https://github.com/lovell/sharp/blob/df7b8ba73808fc494be413e88cfb621b6279218c/lib/output.js#L6-L17
const FORMATS = new Map([
  ['heic', 'heif'],
  ['heif', 'heif'],
  ['avif', 'avif'],
  ['jpeg', 'jpeg'],
  ['jpg', 'jpeg'],
  ['png', 'png'],
  ['raw', 'raw'],
  ['tiff', 'tiff'],
  ['webp', 'webp'],
  ['gif', 'gif'],
]);

export default (new Transformer({
  async transform({asset}) {
    asset.bundleBehavior = 'isolated';

    let width = asset.query.width ? parseInt(asset.query.width, 10) : null;
    let height = asset.query.height ? parseInt(asset.query.height, 10) : null;
    let quality = asset.query.quality
      ? parseInt(asset.query.quality, 10)
      : undefined;
    let format = asset.query.as ? asset.query.as.toLowerCase().trim() : null;

    if (width || height || quality || format) {
      let inputBuffer = await asset.getBuffer();
      let imagePipeline = sharp(inputBuffer);
      if (width || height) {
        imagePipeline.resize(width, height);
      }

      imagePipeline.rotate();

      if (format) {
        if (!FORMATS.has(format)) {
          throw new Error(`Sharp does not support ${format} images.`);
        }

        asset.type = format;

        imagePipeline[FORMATS.get(format)]({
          quality,
        });
      }

      asset.setStream(imagePipeline);
    }

    return [asset];
  },
}): Transformer);
