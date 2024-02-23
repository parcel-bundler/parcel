// @flow strict-local

import {Transformer} from '@parcel/plugin';
import {parseJSON5} from '@parcel/utils';

export default (new Transformer({
  async transform({asset}) {
    asset.type = 'js';
    // Use JSON.parse("...") for faster script parsing, see
    // https://v8.dev/blog/cost-of-javascript-2019#json.
    // Apply `JSON.stringify` twice to make it a valid string literal.
    asset.setCode(
      `module.exports = JSON.parse(${JSON.stringify(
        JSON.stringify(parseJSON5(asset.filePath, await asset.getCode())),
      )});`,
    );
    return [asset];
  },
}): Transformer);
