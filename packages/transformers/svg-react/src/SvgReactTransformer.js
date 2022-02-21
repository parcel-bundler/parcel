// @flow

import {Transformer} from '@parcel/plugin';

import svgoPlugin from '@svgr/plugin-svgo';
import jsxPlugin from '@svgr/plugin-jsx';
import {transform} from '@svgr/core';

export default (new Transformer({
  async loadConfig({config}) {
    let result = await config.getConfig(['.svgrrc', '.svgrrc.json']);
    return result?.contents ?? {};
  },

  async transform({asset, config}) {
    let code = await asset.getCode();

    const jsx = await transform(
      code,
      {...config, runtimeConfig: false},
      {
        caller: {
          name: '@parcel/transformer-svg-react',
          defaultPlugins: [svgoPlugin, jsxPlugin],
        },
        filePath: asset.filePath,
      },
    );

    asset.type = 'jsx';
    asset.bundleBehavior = null;
    asset.setCode(jsx);

    return [asset];
  },
}): Transformer);
