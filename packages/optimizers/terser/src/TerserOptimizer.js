// @flow

import nullthrows from 'nullthrows';
import {minify} from 'terser';
import {Optimizer} from '@parcel/plugin';
import {loadConfig} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import path from 'path';

export default new Optimizer({
  async optimize({contents, map, bundle, options}) {
    if (!bundle.env.minify) {
      return {contents, map};
    }

    if (typeof contents !== 'string') {
      throw new Error(
        'TerserOptimizer: Only string contents are currently supported',
      );
    }

    let userConfig = await loadConfig(
      options.inputFS,
      path.join(options.projectRoot, 'index'),
      ['.terserrc', '.uglifyrc', '.uglifyrc.js', '.terserrc.js'],
    );

    let config = {
      warnings: true,
      ...userConfig?.config,
      compress: {
        ...userConfig?.config?.compress,
        toplevel:
          bundle.env.outputFormat === 'esmodule' ||
          bundle.env.outputFormat === 'commonjs',
      },
      sourceMap: {
        filename: path.relative(options.projectRoot, bundle.filePath),
      },
      module: bundle.env.outputFormat === 'esmodule',
    };

    let sourceMap = null;
    let mappingsBuffer = [];
    if (options.sourceMaps) {
      sourceMap = new SourceMap();

      // $FlowFixMe
      config.output = {
        source_map: {
          add(source, gen_line, gen_col, orig_line, orig_col, name) {
            mappingsBuffer.push({
              source,
              name,
              original: {
                line: orig_line,
                column: orig_col,
              },
              generated: {
                line: gen_line,
                column: gen_col,
              },
            });

            if (mappingsBuffer.length > 25) {
              // $FlowFixMe
              sourceMap.addIndexedMappings(mappingsBuffer);
              mappingsBuffer = [];
            }
          },
        },
      };
    }

    let result = minify(contents, config);

    if (sourceMap && map) {
      sourceMap.addIndexedMappings(mappingsBuffer);
      sourceMap = sourceMap.extends(map.toBuffer());
    }

    if (result.error) {
      throw result.error;
    }

    return {contents: nullthrows(result.code), map: sourceMap};
  },
});
