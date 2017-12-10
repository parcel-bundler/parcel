const {minify} = require('uglify-es');
const generate = require('babel-generator').default;

module.exports = async function(asset) {
  await asset.parseIfNeeded();

  // Convert AST into JS
  let code = asset.isAstDirty
    ? generate(asset.ast).code
    : asset.outputCode || asset.contents;

  let result = minify(code, {
    toplevel: true
  });

  if (result.error) throw result.error;

  // Uglify did our code generation for us, so remove the old AST
  asset.ast = null;
  asset.outputCode = result.code;
  asset.isAstDirty = false;
};
