// @flow
import {Transformer} from '@parcel/plugin';

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

const SHARP_RANGE = '^0.28.3';

export default (new Transformer({
  async transform({asset, options}) {
    asset.bundleBehavior = 'isolated';

    let width =
      typeof asset.query.width === 'string'
        ? parseInt(asset.query.width, 10)
        : null;
    let height =
      typeof asset.query.height === 'string'
        ? parseInt(asset.query.height, 10)
        : null;
    let quality =
      typeof asset.query.quality === 'string'
        ? parseInt(asset.query.quality, 10)
        : undefined;
    let format =
      typeof asset.query.as === 'string'
        ? asset.query.as.toLowerCase().trim()
        : null;

    if (width || height || quality || format) {
      let inputBuffer = await asset.getBuffer();
      let sharp = await options.packageManager.require(
        'sharp',
        asset.filePath,
        {
          range: SHARP_RANGE,
          shouldAutoInstall: options.shouldAutoInstall,
        },
      );

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
