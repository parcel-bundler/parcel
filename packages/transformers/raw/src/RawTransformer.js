// @flow strict-local

import {Transformer} from '@parcel/plugin';

export default new Transformer({
  parse() {},

  transform(asset) {
    asset.isIsolated = true;
    return [asset];
  }
});
