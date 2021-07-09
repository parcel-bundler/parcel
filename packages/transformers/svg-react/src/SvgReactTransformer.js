// @flow

import {Transformer} from '@parcel/plugin';

import path from 'path';
import camelcase from 'camelcase';
import svgoPlugin from '@svgr/plugin-svgo';
import jsxPlugin from '@svgr/plugin-jsx';
import convert from '@svgr/core';

function getComponentName(filePath) {
  let validCharacters = /[^a-zA-Z0-9_-]/g;
  let name = path.parse(filePath).name.replace(validCharacters, '');
  return camelcase(name, {
    pascalCase: true,
  });
}

export default (new Transformer({
  async transform({asset}) {
    let code = await asset.getCode();
    let componentName = getComponentName(asset.filePath);

    const jsx = await convert(
      code,
      {},
      {
        caller: {
          name: '@parcel/transformer-svg-react',
          defaultPlugins: [svgoPlugin, jsxPlugin],
        },
        filePath: componentName,
      },
    );

    asset.type = 'jsx';
    asset.setCode(jsx);

    return [asset];
  },
}): Transformer);
