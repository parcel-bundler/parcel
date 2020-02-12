// @flow

import {Transformer} from '@parcel/plugin';

import path from 'path';
import camelcase from 'camelcase';
import svgToJsx from 'svg-to-jsx';

import * as babelParser from '@babel/parser';

function getComponentName(filePath) {
  let validCharacters = /[^a-zA-Z0-9_-]/g;
  let name = path.parse(filePath).name.replace(validCharacters, '');
  let pascalCaseFileName = camelcase(name, {
    pascalCase: true,
  });

  return `Svg${pascalCaseFileName}`;
}

export default new Transformer({
  async parse({asset}) {
    let code = await asset.getCode();
    let componentName = getComponentName(asset.filePath);
    let jsx = await svgToJsx(code);

    code = `import React from 'react';
  export default function ${componentName}(props) {
    return ${jsx.replace(/<svg (.*)>/, '<svg $1 {...props}>')};
  }
  `;

    asset.setCode(code);

    return {
      type: 'babel',
      version: '7.0.0',
      isDirty: false,
      program: babelParser.parse(code, {
        filename: asset.filePath.replace('.svg', '.js'),
        strictMode: false,
        sourceType: 'module',
        plugins: ['exportDefaultFrom', 'jsx'],
      }),
    };
  },

  transform({asset}) {
    asset.type = 'js';
    return [asset];
  },

  async generate({asset}) {
    const code = await asset.getCode();

    return {code};
  },
});
