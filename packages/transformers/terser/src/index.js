import {minify} from 'terser';
import {transformer} from '@parcel/plugin';
import config from '@parcel/utils/config';

// TODO: extract SourceMap from parcel-bundler ?
// Just using an empty class skeleton for now so that linting doesn't fail
class SourceMap {
  addMapping() {}
  extendSourceMap() {}
}

export default transformer({
  async getConfig(module /* , options */) {
    return config.load(module.filePath, [
      '.terserrc',
      '.uglifyrc',
      '.uglifyrc.js',
      '.terserrc.js'
    ]);
  },

  async transform(module, config, options) {
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
      sourceMap = await new SourceMap().extendSourceMap(module.map, sourceMap);
    }

    if (result.error) {
      throw result.error;
    }

    return [
      {
        type: 'js',
        blobs: {
          code: result.code,
          map: sourceMap
        }
      }
    ];
  }
});
