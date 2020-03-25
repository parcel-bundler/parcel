// @flow

import type {MutableAsset, AST, PluginOptions} from '@parcel/types';

import invariant from 'assert';
import {relativeUrl} from '@parcel/utils';

import {BABEL_RANGE} from './constants';
import packageJson from '../package.json';

const transformerVersion: mixed = packageJson.version;
invariant(typeof transformerVersion === 'string');

export default async function babel7(
  asset: MutableAsset,
  options: PluginOptions,
  babelOptions: any,
  additionalPlugins: Array<any> = [],
): Promise<?AST> {
  // If this is an internally generated config, use our internal @babel/core,
  // otherwise require a local version from the package we're compiling.
  let babel = babelOptions.internal
    ? require('@babel/core')
    : await options.packageManager.require('@babel/core', asset.filePath, {
        range: BABEL_RANGE,
      });

  let sourceFilename: string = relativeUrl(options.projectRoot, asset.filePath);

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
      sourceFilename,
      allowReturnOutsideFunction: true,
      strictMode: false,
      sourceType: 'module',
      plugins: ['dynamicImport'],
    },
    caller: {
      name: 'parcel',
      version: transformerVersion,
      targets: JSON.stringify(babelOptions.targets),
      env: asset.env.outputFormat,
    },
  };

  let ast = await asset.getAST();
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
      program: res.ast,
    });
  }
}
