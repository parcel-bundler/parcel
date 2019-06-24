// @flow

import nullthrows from 'nullthrows';
import {minify} from 'terser';
import {Optimizer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';
import path from 'path';

export default new Optimizer({
  async optimize({contents, map, bundle, options}) {
    if (!options.minify) {
      return {contents, map};
    }

    if (typeof contents !== 'string') {
      throw new Error(
        'TerserOptimizer: Only string contents are currently supported'
      );
    }

    let userConfig = await bundle
      .getEntryAssets()[0]
      .getConfig(['.terserrc', '.uglifyrc', '.uglifyrc.js', '.terserrc.js'], {
        packageKey: 'terser'
      });

    let config = {
      warnings: true,
      ...userConfig,
      sourceMap: {filename: path.relative(options.projectRoot, bundle.filePath)}
    };

    let sourceMap = null;
    if (options.sourceMaps) {
      sourceMap = new SourceMap();
      config.output = {
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

    if (sourceMap && map) {
      sourceMap = await map.extend(sourceMap);
    }

    let result = minify(contents, config);

    if (result.error) {
      throw result.error;
    }

    return {contents: nullthrows(result.code), map: sourceMap};
  }
});
