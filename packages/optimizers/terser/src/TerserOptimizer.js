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

    let originalMap = map ? await map.stringify({}) : null;
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
        asObject: true,
        content: originalMap,
      },
      module: bundle.env.outputFormat === 'esmodule',
    };

    let result = minify(contents, config);

    if (result.error) {
      throw result.error;
    }

    let sourceMap = null;
    if (result.map) {
      sourceMap = await SourceMap.fromRawSourceMap(result.map);
    }

    return {contents: nullthrows(result.code), map: sourceMap};
  },
});
