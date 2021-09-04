// @flow
import {Compressor} from '@parcel/plugin';
import zlib from 'zlib';

export default (new Compressor({
  compress({stream}) {
    return {
      stream: stream.pipe(zlib.createBrotliCompress()),
      type: 'br',
    };
  },
}): Compressor);
