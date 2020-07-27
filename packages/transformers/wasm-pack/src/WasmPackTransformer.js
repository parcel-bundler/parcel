// @flow

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async transform({asset}) {
    await Promise.resolve();
    return [asset];
  },
}): Transformer);
