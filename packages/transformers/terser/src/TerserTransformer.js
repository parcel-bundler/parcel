// @flow

import nullthrows from 'nullthrows';
import {minify} from 'terser';
import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';

export default new Transformer({
  async getConfig({asset}) {
    return asset.getConfig([
      '.terserrc',
      '.uglifyrc',
      '.uglifyrc.js',
      '.terserrc.js'
    ]);
  },

  async transform({asset, config, options}) {
    if (!options.minify) {
      return [asset];
    }

    let terserOptions = {
      warnings: true,
      mangle: {
        toplevel: false
      }
    };

    let sourceMap = null;
    if (options.sourceMaps) {
      sourceMap = new SourceMap();
      // $FlowFixMe
      terserOptions.output = {
        source_map: {
          add(source, gen_line, gen_col, orig_line, orig_col, name) {
            // $FlowFixMe
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

    let result = minify(await asset.getCode(), terserOptions);

    // $FlowFixMe
    if (sourceMap && asset.map) {
      // $FlowFixMe
      sourceMap = asset.map.extend(sourceMap);
    }

    if (result.error) {
      throw result.error;
    }

    let code = nullthrows(result.code);

    return [
      {
        type: 'js',
        code,
        map: sourceMap
      }
    ];
  }
});
