// @flow

import {Transformer} from '@parcel/plugin';

import path from 'path';
import camelcase from 'camelcase';
import svgToJsx from 'svg-to-jsx';

function getComponentName(filePath) {
  let validCharacters = /[^a-zA-Z0-9_-]/g;
  let name = path.parse(filePath).name.replace(validCharacters, '');
  let pascalCaseFileName = camelcase(name, {
    pascalCase: true,
  });

  return `Svg${pascalCaseFileName}`;
}

export default new Transformer({
  async transform({asset}) {
    let code = await asset.getCode();
    let componentName = getComponentName(asset.filePath);
    let jsx = await svgToJsx(code);

    code = `import React from 'react';
    export default function ${componentName}(props) {
      return ${jsx.replace(/<svg (.*)>/, '<svg $1 {...props}>')};
    }
    `;

    asset.type = 'js';
    asset.setCode(code);

    return [asset];
  },
});
