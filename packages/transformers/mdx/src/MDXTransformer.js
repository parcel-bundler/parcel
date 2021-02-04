// @flow
import {Transformer} from '@parcel/plugin';
import mdx from '@mdx-js/mdx';

export default (new Transformer({
  async transform({asset}) {
    let code = await asset.getCode();
    let compiled = await mdx(code);

    asset.type = 'js';
    // TODO: resolve @mdx-js/react relative to the plugin rather than the asset?
    asset.setCode(`/* @jsx mdx */
import React from 'react';
import { mdx } from '@mdx-js/react'
${compiled}
`);

    return [asset];
  },
}): Transformer);
