// @flow
import {Optimizer} from '@parcel/plugin';
import {blobToBuffer, relativePath} from '@parcel/utils';
import {optimize} from '../native';

export default (new Optimizer({
  async optimize({bundle, contents, logger, options}) {
    if (!bundle.env.shouldOptimize) {
      return {contents};
    }

    let buffer = await blobToBuffer(contents);

    // Attempt to optimize it, if the optimize fails we log a warning...
    try {
      let optimized = optimize(bundle.type, buffer);
      return {
        contents: optimized.length < buffer.length ? optimized : buffer,
      };
    } catch (err) {
      const filepath = bundle.getMainEntry()?.filePath;
      const filename = filepath
        ? relativePath(options.projectRoot, filepath)
        : 'unknown';
      logger.warn({
        message: `Could not optimize image ${filename}: ${err.message}`,
        stack: err.stack,
      });
    }

    return {contents: buffer};
  },
}): Optimizer);
