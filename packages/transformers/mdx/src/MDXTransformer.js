// @flow
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async transform({asset}) {
    let { compile } = await import('@mdx-js/mdx');
    let code = await asset.getCode();

    try {
      let compiled = await compile(code);
      asset.type = 'js';
      asset.setCode(compiled.value);
    } catch (e) {
      throw e.toString(); // Adds the line and column number of errors
    }

    return [asset];
  },
}): Transformer);
