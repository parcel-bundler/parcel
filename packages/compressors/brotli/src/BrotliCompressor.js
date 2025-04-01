// @flow strict-local
import {Compressor} from '@parcel/plugin';
import zlib from 'zlib';

export default (new Compressor({
  compress({options, stream}) {
    if (options.mode !== 'production') {
      return null;
    }

    return {
      stream: stream.pipe(
        zlib.createBrotliCompress({
          [zlib.constants.BROTLI_PARAM_QUALITY]:
            zlib.constants.BROTLI_MAX_QUALITY,
        }),
      ),
      type: 'br',
    };
  },
}): Compressor);
