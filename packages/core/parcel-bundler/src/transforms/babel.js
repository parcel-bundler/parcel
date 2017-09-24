const babel = require('babel-core');
const path = require('path');
const config = require('../utils/config');

module.exports = async function (asset) {
  if (!(await shouldTransform(asset))) {
    return;
  }

  await asset.parseIfNeeded();

  let res = babel.transformFromAst(asset.ast, asset.contents, {code: false, filename: asset.name});
  asset.ast = res.ast;
  asset.isAstDirty = true;
};

async function shouldTransform(asset) {
  if (asset.ast) {
    return !!asset.babelConfig;
  }

  if (asset.package && asset.package.babel) {
    return true;
  }

  let babelrc = await config.resolve(asset.name, ['.babelrc', '.babelrc.js']);
  return !!babelrc;
}