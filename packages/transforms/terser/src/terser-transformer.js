const {minify} = require('terser');
const config = require('@parcel/utils/config');

exports.getConfig = async function(module, options) {
  return config.load(module.name, ['.terserrc', '.uglifyrc', '.uglifyrc.js', '.terserrc.js']);
};

exports.transform = async function(module, config, options) {
  let terserOptions = {
    warnings: true,
    mangle: {
      toplevel: true
    }
  };

  let sourceMap = null;
  if (options.sourceMaps) {
    sourceMap = new SourceMap();
    terserOptions.output = {
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

  if (config) {
    terserOptions = Object.assign({}, terserOptions, config);
  }

  let result = minify(module.code, terserOptions);

  if (sourceMap && module.map) {
    sourceMap = await new SourceMap().extendSourceMap(
      module.map,
      sourceMap
    );
  }

  if (result.error) {
    throw result.error;
  }

  return [{
    type: 'js',
    map: sourceMap,
    code: result.code
  }];
}
