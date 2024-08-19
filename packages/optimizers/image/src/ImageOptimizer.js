// @flow
import path from 'path';
import process from 'process';
import {Optimizer} from '@atlaspack/plugin';
import {blobToBuffer} from '@atlaspack/utils';
import {md} from '@atlaspack/diagnostic';
import {optimizeImage} from '@atlaspack/rust';

export default (new Optimizer({
  async optimize({bundle, contents, logger}) {
    if (!bundle.env.shouldOptimize) {
      return {contents};
    }

    let buffer = await blobToBuffer(contents);

    // Attempt to optimize it, if the optimize fails we log a warning...
    try {
      let optimized = optimizeImage(bundle.type, buffer);
      return {
        contents: optimized.length < buffer.length ? optimized : buffer,
      };
    } catch (err) {
      const filepath = bundle.getMainEntry()?.filePath;
      const filename = filepath
        ? path.relative(process.cwd(), filepath)
        : 'unknown';
      logger.warn({
        message: md`Could not optimize image ${filename}: ${err.message}`,
        stack: err.stack,
      });
    }

    return {contents: buffer};
  },
}): Optimizer);
