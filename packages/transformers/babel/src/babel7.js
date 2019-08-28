// @flow
import type {MutableAsset, AST, PluginOptions} from '@parcel/types';

export default async function babel7(
  asset: MutableAsset,
  options: PluginOptions,
  babelOptions: any
): Promise<?AST> {
  let config = babelOptions.config;

  // If this is an internally generated config, use our internal @babel/core,
  // otherwise require a local version from the package we're compiling.
  let babel = babelOptions.internal
    ? require('@babel/core')
    : await options.packageManager.require('@babel/core', asset.filePath);

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
