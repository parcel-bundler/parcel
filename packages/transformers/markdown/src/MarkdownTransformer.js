// @flow

import {Transformer} from '@parcel/plugin';
import marked from 'marked';

export default new Transformer({
  async transform({asset}) {
    asset.type = 'html';
    let code = await asset.getCode();
    asset.setCode(marked(code));
    return [asset];
  }
});
