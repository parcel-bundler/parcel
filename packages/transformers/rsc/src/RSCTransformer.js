// @flow

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async transform({asset}) {
    if (asset.env.isNode()) {
      let client = await asset.getCode();
      if (/["']use client["']/.test(client)) {
        return [
          {
            type: 'js',
            content: client,
            uniqueKey: 'client',
            env: {
              context: 'browser',
              outputFormat: 'esmodule',
              includeNodeModules: true
            },
            meta: {
              isClientComponent: true
            }
          }
        ];
      }
    }

    return [asset];
  },
}): Transformer);
