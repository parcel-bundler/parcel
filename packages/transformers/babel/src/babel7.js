// @flow

import type {LocalRequire, MutableAsset, AST} from '@parcel/types';
import packageJson from '../package.json';
import invariant from 'assert';

const transformerVersion: mixed = packageJson.version;
invariant(typeof transformerVersion === 'string');

export default async function babel7(
  asset: MutableAsset,
  localRequire: LocalRequire,
  options: any
): Promise<?AST> {
  // If this is an internally generated config, use our internal @babel/core,
  // otherwise require a local version from the package we're compiling.
  let babel = options.internal
    ? require('@babel/core')
    : await localRequire('@babel/core', asset.filePath);

  let config = {
    ...options.config,
    code: false,
    ast: true,
    filename: asset.filePath,
    babelrc: false,
    configFile: false,
    parserOpts: {
      ...options.config.parserOpts,
      allowReturnOutsideFunction: true,
      strictMode: false,
      sourceType: 'module',
      plugins: ['dynamicImport']
    },
    caller: {
      name: 'parcel',
      version: transformerVersion,
      targets: JSON.stringify(options.targets)
    }
  };

  let code = await asset.getCode();

  let res;
  if (asset.ast) {
    res = babel.transformFromAstSync(asset.ast.program, code, config);
  } else {
    res = babel.transformSync(code, config);
  }

  if (res.ast) {
    return {
      type: 'babel',
      version: '7.0.0',
      program: res.ast,
      isDirty: true
    };
  }
}
