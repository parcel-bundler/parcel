// @flow strict-local

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  transform({asset}) {
    asset.symbols.clear();
    return [asset];
  },
}): Transformer);
