const babel = require('babel-core');
const path = require('path');
const config = require('../utils/config');

module.exports = async function (asset) {
  if (!asset.babelConfig) {
    return;
  }

  await asset.parseIfNeeded();

  let res = babel.transformFromAst(asset.ast, asset.contents, {code: false, filename: asset.name});
  asset.ast = res.ast;
  asset.isAstDirty = true;
};
