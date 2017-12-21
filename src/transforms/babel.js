const babel = require('babel-core');
const config = require('../utils/config');

module.exports = async function(asset) {
  if (!await shouldTransform(asset)) {
    return;
  }

  await asset.parseIfNeeded();

  let config = {
    code: false,
    filename: asset.name
  };

  if (asset.isES6Module) {
    config.plugins = [
      require('babel-plugin-transform-es2015-modules-commonjs')
    ];
  }

  let res = babel.transformFromAst(asset.ast, asset.contents, config);
  asset.ast = res.ast;
  asset.isAstDirty = true;
};

async function shouldTransform(asset) {
  if (asset.isES6Module) {
    return true;
  }

  if (asset.ast) {
    return !!asset.config.babelConfig;
  }

  if (asset.package && asset.package.babel) {
    return true;
  }

  await asset.getConfig();
  let babelrc = asset.config.babelConfig;
  return !!babelrc;
}
