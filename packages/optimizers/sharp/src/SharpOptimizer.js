// @flow

import {Optimizer} from '@parcel/plugin';
import {blobToBuffer} from '@parcel/utils';
import path from 'path';
import sharp from 'sharp';

const DEFAULT_OPTIONS = {
  avif: {},
  heif: {},
  gif: {},
  jpeg: {
    mozjpeg: true,
  },
  png: {
    palette: true,
  },
  raw: {},
  tiff: {},
  webp: {},
};

// from https://github.com/lovell/sharp/blob/df7b8ba73808fc494be413e88cfb621b6279218c/lib/output.js#L6-L17
const FORMATS = new Map<string, $Keys<typeof DEFAULT_OPTIONS>>([
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

export default (new Optimizer({
  async loadConfig({config}) {
    let userConfig = await config.getConfig(
      ['.sharprc', '.sharprc.json', '.sharprc.js', 'sharp.config.js'],
      {
        packageKey: 'sharp',
      },
    );

    if (userConfig) {
      let isJavascript = path.extname(userConfig.filePath) === '.js';
      if (isJavascript) {
        config.invalidateOnStartup();
      }
    }

    return userConfig?.contents;
  },

  async optimize({bundle, contents, config}) {
    if (!bundle.env.shouldOptimize) {
      return {contents};
    }

    const ext = path.extname(bundle.name).substr(1);
    const format = FORMATS.get(ext);

    if (!format) {
      throw new Error(`Sharp does not support ${ext} images.`);
    }

    const options = {...DEFAULT_OPTIONS[format], ...config?.[format]};

    const optimized = await sharp(await blobToBuffer(contents))
      [format](options)
      .rotate()
      .toBuffer();

    return {contents: optimized};
  },
}): Optimizer);
