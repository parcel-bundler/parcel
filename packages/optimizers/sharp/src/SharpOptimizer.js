// @flow

import {Optimizer} from '@parcel/plugin';
import {blobToBuffer} from '@parcel/utils';
import path from 'path';
import sharp from 'sharp';

const OPTIONS = {
  jpeg: {
    quality: 75,
    mozjpeg: true,
  },
  png: {
    palette: true,
  },
};

const FORMATS = new Map<string, $Keys<typeof OPTIONS>>([
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['png', 'png'],
]);

export default (new Optimizer({
  async optimize({bundle, contents}) {
    if (!bundle.env.shouldOptimize) {
      return {contents};
    }

    const ext = path.extname(bundle.name).substr(1);
    const format = FORMATS.get(ext);

    if (!format) {
      throw new Error(`Sharp does not support ${ext} images.`);
    }

    const optimized = await sharp(await blobToBuffer(contents))
      [format](OPTIONS[format])
      .toBuffer();

    return {contents: optimized};
  },
}): Optimizer);
