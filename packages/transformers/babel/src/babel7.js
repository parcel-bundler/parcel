// @flow
import type {MutableAsset, AST} from '@parcel/types';
import localRequire from '@parcel/local-require';

export default async function babel7(
  asset: MutableAsset,
  options: any
): Promise<?AST> {
  let config = options.config;

  // If this is an internally generated config, use our internal @babel/core,
  // otherwise require a local version from the package we're compiling.
  let babel = options.internal
    ? require('@babel/core')
    : await localRequire('@babel/core', asset.filePath);

  config.code = false;
  config.ast = true;
  config.filename = asset.filePath;
  config.babelrc = false;
  config.configFile = false;
  config.parserOpts = Object.assign({}, config.parserOpts, {
    allowReturnOutsideFunction: true,
    strictMode: false,
    sourceType: 'module',
    plugins: ['dynamicImport']
  });

  let code = await asset.getCode();

  let res;
  if (asset.ast) {
    res = babel.transformFromAst(asset.ast.program, code, config);
  } else {
    res = babel.transformSync(code, config);
  }

  if (res.ast) {
    return {
      type: 'babel',
      version: '7.0.0',
      program: res.ast
    };
  }
}
