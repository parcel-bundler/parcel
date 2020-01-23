// @flow
import {Transformer} from '@parcel/plugin';
import mdx from '@mdx-js/mdx';

export default new Transformer({
  async transform({asset}) {
    const compiled = await mdx(await asset.getCode());

    asset.type = 'js';
    asset.setCode(`/* @jsx mdx */
import React from 'react';
import { mdx } from '@mdx-js/react'
${compiled}
`);

    return [asset];
  },
});
