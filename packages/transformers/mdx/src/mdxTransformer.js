// @flow

import {Transformer} from '@parcel/plugin';
import mdx from '@mdx-js/mdx';

export default new Transformer({
  async transform({asset}) {
    // // TODO: change this. This is for resolving these files from a consumer's project if present.
    // const config = await this.getConfig(
    //   ['.mdxrc', 'mdx.config.js', 'package.json'],
    //   {packageKey: 'mdx'}
    // );
    // const compiled = await mdx(this.contents, config);
    const compiled = await mdx(await asset.getCode());
    asset.setCode(`/* @jsx mdx */
import React from 'react';
import { mdx } from '@mdx-js/react'
${compiled}
`);

    asset.type = 'js';
    return [asset];
  }
});
