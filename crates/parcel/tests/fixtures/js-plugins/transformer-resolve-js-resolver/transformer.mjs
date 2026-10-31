import {Transformer} from '@parcel/plugin';
import path from 'path';

// Resolves through the JS resolver while this transformer is running.
export default new Transformer({
  async transform({asset, resolve}) {
    let {filePath: resolved} = await resolve(asset.filePath, asset.getCode().trim());
    asset.type = 'js';
    asset.setCode(`export default ${JSON.stringify('resolved:' + path.relative(path.dirname(asset.filePath), resolved))};`);
    return [asset];
  },
});
