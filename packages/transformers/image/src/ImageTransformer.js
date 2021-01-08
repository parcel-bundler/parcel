// @flow
import {Transformer} from '@parcel/plugin';

const FORMATS = new Map([
  ['heic', 'heif'],
  ['heif', 'heif'],
  ['jpeg', 'jpeg'],
  ['jpg', 'jpeg'],
  ['png', 'png'],
  ['raw', 'raw'],
  ['tiff', 'tiff'],
  ['webp', 'webp'],
]);

export default (new Transformer({
  async transform({asset, options}) {
    asset.isIsolated = true;

    let width = asset.query.width ? parseInt(asset.query.width, 10) : null;
    let height = asset.query.height ? parseInt(asset.query.height, 10) : null;
    let quality = asset.query.quality
      ? parseInt(asset.query.quality, 10)
      : undefined;
    let format = asset.query.as ? asset.query.as.toLowerCase().trim() : null;

    if (width || height || quality || format) {
      const sharp = await options.packageManager.require(
        'sharp',
        asset.filePath,
        {
          // Sharp takes too long to install for shouldAutoInstall option to make sense
          shouldAutoInstall: false,
        },
      );

      let inputBuffer = await asset.getBuffer();
      let imagePipeline = sharp(inputBuffer);
      if (width || height) {
        imagePipeline.resize(width, height);
      }

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
