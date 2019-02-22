// @flow
import {minify} from 'terser';
import {Transformer} from '@parcel/plugin';

// TODO: extract SourceMap from parcel-bundler ?
// Just using an empty class skeleton for now so that linting doesn't fail
// class SourceMap {
//   addMapping() {}
//   extendSourceMap() {}
// }

export default new Transformer({
  async getConfig(asset) {
    return asset.getConfig([
      '.terserrc',
      '.uglifyrc',
      '.uglifyrc.js',
      '.terserrc.js'
    ]);
  },

  async transform(asset, config, options) {
    if (!options.minify) {
      return [asset];
    }

    let terserOptions = {
      warnings: true,
      mangle: {
        toplevel: false
      }
    };

    // let sourceMap = null;
    // if (options.sourceMaps) {
    //   sourceMap = new SourceMap();
    //   terserOptions.output = {
    //     source_map: {
    //       add(source, gen_line, gen_col, orig_line, orig_col, name) {
    //         sourceMap.addMapping({
    //           source,
    //           name,
    //           original: {
    //             line: orig_line,
    //             column: orig_col
    //           },
    //           generated: {
    //             line: gen_line,
    //             column: gen_col
    //           }
    //         });
    //       }
    //     }
    //   };
    // }

    if (config) {
      terserOptions = Object.assign({}, terserOptions, config);
    }

    let result = minify(asset.code, terserOptions);

    // if (sourceMap && asset.output.map) {
    //   sourceMap = await new SourceMap().extendSourceMap(
    //     asset.output.map,
    //     sourceMap
    //   );
    // }

    if (result.error) {
      throw result.error;
    }

    return [
      {
        type: 'js',
        output: {
          code: result.code
          // map: sourceMap
        }
      }
    ];
  }
});
