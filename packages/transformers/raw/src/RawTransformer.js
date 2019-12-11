// @flow strict-local

import {Transformer} from '@parcel/plugin';

export default new Transformer({
  transform({asset}) {
    asset.isIsolated = true;
    return [asset];
  },
});
