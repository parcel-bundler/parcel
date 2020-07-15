// @flow strict-local

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  transform({asset}) {
    asset.isInline = true;
    asset.meta.inlineType = 'string';
    return [asset];
  },
}): Transformer);
