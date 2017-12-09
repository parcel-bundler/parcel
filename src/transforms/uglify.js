const {AST_Node, minify} = require('uglify-es');
const {toEstree} = require('babel-to-estree');
const types = require('babel-types');
const walk = require('babylon-walk');

module.exports = async function(asset) {
  await asset.parseIfNeeded();

  // Convert to UglifyES AST
  var ast = AST_Node.from_mozilla_ast(toEstree(asset.ast, asset.contents));
  var result = minify(ast, {
    toplevel: true
  });

  // Uglify did our code generation for us, so remove the old AST
  asset.ast = null;
  asset.outputCode = result.code;
  asset.isAstDirty = false;
};
