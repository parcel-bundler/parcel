// @flow
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async transform({asset, options}) {
    let [mdx, code] = await Promise.all([
      options.packageManager.require('@mdx-js/mdx', asset.filePath, {
        shouldAutoInstall: options.shouldAutoInstall,
      }),
      asset.getCode(),
      options.packageManager.resolve('@mdx-js/react', asset.filePath, {
        shouldAutoInstall: options.shouldAutoInstall,
        saveDev: false,
      }),
    ]);

    const compiled = await mdx(code);

    asset.type = 'js';
    asset.setCode(`/* @jsx mdx */
import React from 'react';
import { mdx } from '@mdx-js/react'
${compiled}
`);

    return [asset];
  },
}): Transformer);
