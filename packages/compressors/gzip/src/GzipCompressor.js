// @flow strict-local
import {Compressor} from '@parcel/plugin';
import zlib from 'zlib';

export default (new Compressor({
  compress({options, stream}) {
    if (options.mode !== 'production') {
      return null;
    }

    return {
      stream: stream.pipe(zlib.createGzip({level: 9})),
      type: 'gz',
    };
  },
}): Compressor);
