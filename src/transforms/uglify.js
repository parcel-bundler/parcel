const {minify} = require('uglify-es');
const types = require('babel-types');
const walk = require('babylon-walk');

module.exports = async function(asset) {
  await asset.parseIfNeeded();

  // Minify with UglifyES
  var result = minify(asset.generate().js, {
    toplevel: true
  });

  if (result.error) throw result.error;

  // Uglify did our code generation for us, so remove the old AST
  asset.ast = null;
  asset.outputCode = result.code;
  asset.isAstDirty = false;
};
