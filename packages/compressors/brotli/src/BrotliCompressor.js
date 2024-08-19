// @flow strict-local
import {Compressor} from '@atlaspack/plugin';
import zlib from 'zlib';

export default (new Compressor({
  compress({options, stream}) {
    if (options.mode !== 'production') {
      return null;
    }

    return {
      stream: stream.pipe(zlib.createBrotliCompress()),
      type: 'br',
    };
  },
}): Compressor);
