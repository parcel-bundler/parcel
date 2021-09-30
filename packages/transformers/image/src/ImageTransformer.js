// @flow
import {validateConfig} from './validateConfig';
import {Transformer} from '@parcel/plugin';
import nullthrows from 'nullthrows';

// from https://github.com/lovell/sharp/blob/df7b8ba73808fc494be413e88cfb621b6279218c/lib/output.js#L6-L17
const FORMATS = new Map([
  ['jpeg', 'jpeg'],
  ['jpg', 'jpeg'],
  ['png', 'png'],
  ['webp', 'webp'],
  ['gif', 'gif'],
  ['tiff', 'tiff'],
  ['avif', 'avif'],
  ['heic', 'heif'],
  ['heif', 'heif'],
]);

const SHARP_RANGE = '^0.29.1';

export default (new Transformer({
  async loadConfig({config}) {
    let configFile: any = await config.getConfig(
      ['sharp.config.json'], // '.sharprc', '.sharprc.json'
      {packageKey: 'sharp'},
    );

    if (configFile?.contents) {
      validateConfig(configFile.contents, configFile.filePath);
      return configFile.contents;
    } else {
      return {};
    }
  },

  async transform({config, asset, options}) {
    asset.bundleBehavior = 'isolated';

    const originalFormat = FORMATS.get(asset.type);
    if (!originalFormat) {
      throw new Error(
        `The image transformer does not support ${asset.type} images.`,
      );
    }

    const width = asset.query.width ? parseInt(asset.query.width, 10) : null;
    const height = asset.query.height ? parseInt(asset.query.height, 10) : null;
    const quality = asset.query.quality
      ? parseInt(asset.query.quality, 10)
      : config.quality;
    let targetFormat = asset.query.as
      ? asset.query.as.toLowerCase().trim()
      : null;
    if (targetFormat && !FORMATS.has(targetFormat)) {
      throw new Error(
        `The image transformer does not support ${targetFormat} images.`,
      );
    }

    const format = nullthrows(FORMATS.get(targetFormat || originalFormat));
    const outputOptions = config[format];

    if (width || height || quality || targetFormat || outputOptions) {
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

      const normalizedOutputOptions = outputOptions || {};
      if (format === 'jpeg') {
        normalizedOutputOptions.mozjpeg =
          normalizedOutputOptions.mozjpeg ?? true;
      }
      imagePipeline[format]({
        quality,
        ...normalizedOutputOptions,
      });

      asset.type = format;

      let buffer = await imagePipeline.toBuffer();
      asset.setBuffer(buffer);
    }

    return [asset];
  },
}): Transformer);
