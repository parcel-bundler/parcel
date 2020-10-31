// @flow

import {Transformer} from '@parcel/plugin';
import json5 from 'json5';

export default (new Transformer({
  async transform({asset}) {
    // This indicates a previous transformer (e.g. WebExt) has applied special
    // handling to this already
    if (asset.meta.handled) {
      return [asset];
    }
    const pure = JSON.stringify(json5.parse(await asset.getCode()));
    if (asset.pipeline == 'raw') {
      // Output as a raw JSON asset (useful for other transformers)
      asset.setCode(pure);
    } else {
      asset.type = 'js';
      // Use JSON.parse("...") for faster script parsing, see
      // https://v8.dev/blog/cost-of-javascript-2019#json.
      // Apply `JSON.stringify` twice to make it a valid string literal.
      asset.setCode(`module.exports = JSON.parse(${JSON.stringify(pure)});`);
    }
    return [asset];
  },
}): Transformer);
