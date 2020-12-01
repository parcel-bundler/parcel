// @flow
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async loadConfig({ config }) {
    return await config.getConfig(
      ['.mdxrc', 'mdx.config.js'],
      {packageKey: 'mdx'},
    );
  }
  
  async transform({asset, options, config }) {
    let [mdx, code] = await Promise.all([
      options.packageManager.require('@mdx-js/mdx', asset.filePath, {
        autoinstall: options.autoinstall,
      }),
      asset.getCode(),
      options.packageManager.resolve('@mdx-js/react', asset.filePath, {
        autoinstall: options.autoinstall,
        saveDev: false,
      }),
    ]);

    const compiled = await mdx(code, config);

    asset.type = 'js';
    asset.setCode(`/* @jsx mdx */
import React from 'react';
import { mdx } from '@mdx-js/react'
${compiled}
`);

    return [asset];
  },
}): Transformer);
