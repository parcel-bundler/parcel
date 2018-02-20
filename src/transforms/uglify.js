const {minify} = require('uglify-es');
const SourceMap = require('../SourceMap');

module.exports = async function(asset) {
  await asset.parseIfNeeded();

  // Convert AST into JS
  let source = (await asset.generate()).js;

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

  let {code, map, error} = minify(source, options);

  if (error) {
    throw error;
  }

  if (map) {
    map = await new SourceMap().addMap(JSON.parse(map));
    if (asset.sourceMap) {
      asset.sourceMap = await new SourceMap().extendSourceMap(
        asset.sourceMap,
        map
      );
    } else {
      asset.sourceMap = map;
    }
  }

  // babel-generator did our code generation for us, so remove the old AST
  asset.ast = null;
  asset.outputCode = code;
  asset.isAstDirty = false;
};
