// @flow strict-local

import {Transformer} from '@parcel/plugin';
import invariant from 'assert';

import * as asc from 'assemblyscript/cli/asc';

export default (new Transformer({
  async transform({asset}) {
    await asc.ready;

    let code = await asset.getCode();
    const {binary} = asc.compileString(code, {
      // optimize: true,
    });

    invariant(binary);
    return [
      {
        content: Buffer.from(binary),
        type: 'wasm',
      },
    ];

    // let uniqueKey = "";
    // return [asset, ]
  },
}): Transformer);
