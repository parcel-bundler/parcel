// @flow strict-local

import * as path from 'path';
// $FlowFixMe swc is untyped?
import * as swc from '@swc/core';
import {Transformer} from '@parcel/plugin';

const swcTransformer: Transformer = new Transformer({
  async transform({asset}) {
    const code = await asset.getCode();
    const {code: newCode} = await swc.transform(code, {
      filename: path.resolve(asset.filePath),
      cwd: path.dirname(asset.filePath),
      sourceMaps: true,
    });
    asset.setCode(`/* @parcel/swc-transformer */\n${newCode}`);
    return [asset];
  },
});

export default swcTransformer;
