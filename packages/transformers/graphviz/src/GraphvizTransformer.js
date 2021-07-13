// @flow

import {Transformer} from '@parcel/plugin';
import {graphviz} from '@hpcc-js/wasm';

export default (new Transformer({
  async transform({asset}) {
    asset.bundleBehavior = 'isolated';

    const input = await asset.getCode();
    const output = await graphviz.layout(input, 'svg');

    asset.type = 'svg';
    asset.setCode(output);

    return [asset];
  },
}): Transformer);
