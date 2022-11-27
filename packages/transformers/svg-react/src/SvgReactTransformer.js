// @flow

import {Transformer} from '@parcel/plugin';

import path from 'path';
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
      'svgr.config.json',
      'svgr.config.js',
      'svgr.config.cjs',
    ]);
    let svgoResult = await config.getConfig([
      'svgo.config.js',
      'svgo.config.cjs',
      'svgo.config.json',
    ]);
    if (svgrResult) {
      let isJavascript = path.extname(svgrResult.filePath).endsWith('js');
      if (isJavascript) {
        config.invalidateOnStartup();
      }
    }
    if (svgoResult) {
      let isJavascript = path.extname(svgoResult.filePath).endsWith('js');
      if (isJavascript) {
        config.invalidateOnStartup();
      }
    }
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
