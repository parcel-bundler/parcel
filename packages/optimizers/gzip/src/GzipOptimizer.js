// @flow strict-local

import {Optimizer} from '@parcel/plugin';
import {blobToStream} from '@parcel/utils';
import zlib from 'zlib';

export default new Optimizer({
  optimize({bundle, contents, map, options}) {
    if (options.mode !== 'production') {
      return {contents, map};
    }

    return {
      type: bundle.type + '.gz',
      contents: blobToStream(contents).pipe(zlib.createGzip()),
      map,
    };
  },
});
