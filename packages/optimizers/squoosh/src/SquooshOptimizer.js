// @flow

import {Optimizer} from '@parcel/plugin';

import {ImagePool} from '@squoosh/lib';
import {blobToBuffer} from '@parcel/utils';
import path from 'path';

let imagePool;

const OPTIONS = {
  mozjpeg: {},
  oxipng: {},
};

const FORMATS = new Map<string, $Keys<typeof OPTIONS>>([
  ['jpg', 'mozjpeg'],
  ['jpeg', 'mozjpeg'],
  ['png', 'oxipng'],
]);

export default (new Optimizer({
  async optimize({bundle, contents}) {
    if (!bundle.env.shouldOptimize) {
      return {contents};
    }

    if (!imagePool) {
      imagePool = new ImagePool();
    }

    const ext = path.extname(bundle.name).substr(1);
    const encoder = FORMATS.get(ext);

    if (!encoder) {
      throw new Error(`Squoosh does not support ${ext} images.`);
    }

    const image = imagePool.ingestImage(await blobToBuffer(contents));

    await image.encode({[encoder]: OPTIONS[encoder]});

    return {contents: (await image.encodedWith[encoder]).binary};
  },
}): Optimizer);
