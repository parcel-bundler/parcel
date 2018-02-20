const {minify} = require('uglify-es');
const SourceMap = require('../SourceMap');

module.exports = async function(asset) {
  await asset.parseIfNeeded();

  // Convert AST into JS
  let code = (await asset.generate()).js;

  let customConfig = await asset.getConfig(['.uglifyrc']);
  let options = {
    warnings: true,
    mangle: {
      toplevel: true
    },
    sourceMap: asset.options.sourceMaps ? {filename: asset.relativeName} : false
  };

  if (customConfig) {
    options = Object.assign(options, customConfig);
  }

  let result = minify(code, options);

  if (result.error) {
    throw result.error;
  }

  if (result.map) {
    result.map = await new SourceMap().addMap(JSON.parse(result.map));
    if (asset.sourceMap) {
      asset.sourceMap = await new SourceMap().extendSourceMap(
        asset.sourceMap,
        result.map
      );
    } else {
      asset.sourceMap = result.map;
    }
  }

  // babel-generator did our code generation for us, so remove the old AST
  asset.ast = null;
  asset.outputCode = result.code;
  asset.isAstDirty = false;
};
