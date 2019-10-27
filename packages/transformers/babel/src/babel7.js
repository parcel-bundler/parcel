// @flow

import type {MutableAsset, AST, PluginOptions} from '@parcel/types';

import packageJson from '../package.json';
import invariant from 'assert';
import {relativeUrl} from '@parcel/utils';

const transformerVersion: mixed = packageJson.version;
invariant(typeof transformerVersion === 'string');

export default async function babel7(
  asset: MutableAsset,
  ast: ?AST,
  options: PluginOptions,
  babelOptions: any
): Promise<?AST> {
  // If this is an internally generated config, use our internal @babel/core,
  // otherwise require a local version from the package we're compiling.
  let babel = babelOptions.internal
    ? require('@babel/core')
    : await options.packageManager.require('@babel/core', asset.filePath);

  let sourceFilename: string = relativeUrl(options.projectRoot, asset.filePath);

  let config = {
    ...babelOptions.config,
    code: false,
    ast: true,
    filename: asset.filePath,
    babelrc: false,
    configFile: false,
    parserOpts: {
      ...babelOptions.config.parserOpts,
      sourceFilename,
      allowReturnOutsideFunction: true,
      strictMode: false,
      sourceType: 'module',
      plugins: ['dynamicImport']
    },
    caller: {
      name: 'parcel',
      version: transformerVersion,
      targets: JSON.stringify(babelOptions.targets)
    }
  };

  let code = await asset.getCode();

  let res;
  if (ast) {
    res = babel.transformFromAstSync(ast.program, code, config);
  } else {
    res = babel.transformSync(code, config);
  }

  if (res.ast) {
    asset.setAST({
      type: 'babel',
      version: '7.0.0',
      program: res.ast
    });
  }
}
