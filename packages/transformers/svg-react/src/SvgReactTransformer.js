// @flow

import {Transformer} from '@parcel/plugin';

import svgoPlugin from '@svgr/plugin-svgo';
import jsxPlugin from '@svgr/plugin-jsx';
import {transform} from '@svgr/core';

export default (new Transformer({
  async loadConfig({config}) {
    let svgrResult = await config.getConfig([
      '.svgrrc',
      '.svgrrc.json',
      '.svgrrc.js',
      '.svgrrc.cjs',
      '.svgrrc.mjs',
      'svgr.config.json',
      'svgr.config.js',
      'svgr.config.cjs',
      'svgr.config.mjs',
    ]);
    let svgoResult = await config.getConfig([
      'svgo.config.js',
      'svgo.config.cjs',
      'svgo.config.mjs',
      'svgo.config.json',
    ]);
    return {svgr: svgrResult?.contents, svgo: svgoResult?.contents};
  },

  async transform({asset, config}) {
    let code = await asset.getCode();

    const jsx = await transform(
      code,
      {svgoConfig: config.svgo, ...config.svgr, runtimeConfig: false},
      {
        caller: {
          name: '@parcel/transformer-svg-react',
          defaultPlugins: [svgoPlugin, jsxPlugin],
        },
        filePath: asset.filePath,
      },
    );

    asset.type = config.svgr?.typescript ? 'tsx' : 'jsx';
    asset.bundleBehavior = null;
    asset.setCode(jsx);

    return [asset];
  },
}): Transformer);
