// @flow
import type {Asset} from '@parcel/types';
import localRequire from '@parcel/utils/localRequire';

export default async function babel7(asset: Asset, options) {
  let config = options.config;

  // If this is an internally generated config, use our internal @babel/core,
  // otherwise require a local version from the package we're compiling.
  let babel = options.internal
    ? require('@babel/core')
    : await localRequire('@babel/core', asset.name);

  // let pkg = await asset.getPackage();

  config.code = false;
  config.ast = true;
  config.filename = asset.filePath;
  // config.cwd = pkg ? pkg.pkgdir : asset.options.rootDir;
  config.babelrc = false;
  config.configFile = false;
  config.parserOpts = Object.assign({}, config.parserOpts, {
    allowReturnOutsideFunction: true,
    strictMode: false,
    sourceType: 'module',
    plugins: ['dynamicImport']
  });

  let res;
  if (asset.ast) {
    res = babel.transformFromAst(asset.ast.program, asset.code, config);
  } else {
    res = babel.transformSync(asset.code, config);
  }

  if (res.ast) {
    return res.ast;
  }
}
