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
    }
  };

  let sourceMap;
  if (asset.options.sourceMap) {
    sourceMap = new SourceMap();
    options.output = {
      source_map: {
        add(source, gen_line, gen_col, orig_line, orig_col, name) {
          sourceMap.addMapping({
            source,
            name,
            original: {
              line: orig_line,
              column: orig_col
            },
            generated: {
              line: gen_line,
              column: gen_col
            }
          });
        }
      }
    };
  }

  if (customConfig) {
    options = Object.assign(options, customConfig);
  }

  let result = minify(source, options);

  if (result.error) {
    throw result.error;
  }

  if (sourceMap) {
    if (asset.sourceMap) {
      asset.sourceMap = await new SourceMap().extendSourceMap(
        asset.sourceMap,
        sourceMap
      );
    } else {
      asset.sourceMap = sourceMap;
    }
  }

  // babel-generator did our code generation for us, so remove the old AST
  asset.ast = null;
  asset.outputCode = result.code;
  asset.isAstDirty = false;
};
