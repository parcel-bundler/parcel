// @flow

import type {MutableAsset, AST, PluginOptions} from '@parcel/types';

import invariant from 'assert';
import * as babel from '@babel/core';
import {relativeUrl} from '@parcel/utils';
import {remapAstLocations} from '@parcel/babel-ast-utils';

import packageJson from '../package.json';

const transformerVersion: mixed = packageJson.version;
invariant(typeof transformerVersion === 'string');

type Babel7TransformOptions = {|
  asset: MutableAsset,
  options: PluginOptions,
  babelOptions: any,
  additionalPlugins?: Array<any>,
|};

export default async function babel7(
  opts: Babel7TransformOptions,
): Promise<?AST> {
  let {asset, options, babelOptions, additionalPlugins = []} = opts;

  let config = {
    ...babelOptions.config,
    plugins: additionalPlugins.concat(babelOptions.config.plugins),
    code: false,
    ast: true,
    filename: asset.filePath,
    babelrc: false,
    configFile: false,
    parserOpts: {
      ...babelOptions.config.parserOpts,
      sourceFilename: relativeUrl(options.projectRoot, asset.filePath),
      allowReturnOutsideFunction: true,
      strictMode: false,
      sourceType: 'module',
    },
    caller: {
      name: 'parcel',
      version: transformerVersion,
      targets: JSON.stringify(babelOptions.targets),
      outputFormat: asset.env.outputFormat,
    },
  };

  let ast = await asset.getAST();
  let res;
  if (ast) {
    res = await babel.transformFromAstAsync(
      ast.program,
      asset.isASTDirty() ? undefined : await asset.getCode(),
      config,
    );
  } else {
    res = await babel.transformAsync(await asset.getCode(), config);
    if (res.ast) {
      let map = await asset.getMap();
      if (map) {
        remapAstLocations(res.ast, map);
      }
    }
  }

  if (res.ast) {
    asset.setAST({
      type: 'babel',
      version: '7.0.0',
      program: res.ast,
    });
  }
}
