const localRequire = require('../../utils/localRequire');

async function babel7(asset, config) {
  // If this is an internally generated config, use our internal @babel/core,
  // otherwise require a local version from the package we're compiling.
  let babel = config.internal
    ? require('@babel/core')
    : await localRequire('@babel/core', asset.name);

  config.code = false;
  config.ast = true;
  config.filename = asset.name;
  config.babelrc = false;
  config.configFile = false;

  let res;
  if (asset.ast) {
    res = babel.transformFromAst(asset.ast, asset.contents, config);
  } else {
    res = babel.transformSync(asset.contents, config);
  }

  if (res.ast) {
    asset.ast = res.ast;
    asset.isAstDirty = true;
  }
}

module.exports = babel7;
