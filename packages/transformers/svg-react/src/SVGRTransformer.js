// @flow

import JSTransformer from '@parcel/transformer-js';

import SVGO from 'svgo';
import path from 'path';
import camelcase from 'camelcase';
import svgToJsx from 'svg-to-jsx';

import * as babelParser from '@babel/parser';

const defaultConfig = {
  plugins: [{prefixIds: true}],
};

function getComponentName(filePath) {
  let validCharacters = /[^a-zA-Z0-9_-]/g;
  let name = path.parse(filePath).name.replace(validCharacters, '');
  let pascalCaseFileName = camelcase(name, {
    pascalCase: true,
  });

  return `Svg${pascalCaseFileName}`;
}

const [parcelPluginSymbol] = Object.getOwnPropertySymbols(JSTransformer);
const getJsConfig = JSTransformer[parcelPluginSymbol].getConfig;

JSTransformer[parcelPluginSymbol].getConfig = async function(opts) {
  let {asset} = opts;
  let config = getJsConfig(opts);
  let svgoConfig = await asset.getConfig(
    [
      '.svgorc',
      '.svgorc.json',
      '.svgorc.yaml',
      '.svgorc.yml',
      'svgo.config.js',
      '.svgo.yml',
    ],
    {
      packageKey: 'svgo',
    },
  );

  svgoConfig = svgoConfig || {};
  svgoConfig = {...defaultConfig, ...svgoConfig};

  this.svgo = new SVGO(svgoConfig);

  return {
    ...config,
    svgo: svgoConfig,
  };
};

JSTransformer[parcelPluginSymbol].parse = async function({asset}) {
  let svgCode = await asset.getCode();
  let componentName = getComponentName(asset.filePath);
  let {data} = await this.svgo.optimize(svgCode);
  let jsx = await svgToJsx(data);
  let code = `import React from 'react';
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
      filename: asset.filePath,
      strictMode: false,
      sourceType: 'module',
      plugins: ['exportDefaultFrom', 'jsx'],
    }),
  };
};

export default JSTransformer;
