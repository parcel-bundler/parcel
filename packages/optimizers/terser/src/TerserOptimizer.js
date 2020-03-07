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

    // $FlowFixMe
    let result = minify(contents, config);

    // $FlowFixMe
    let jsonmap = JSON.parse(result.map);
    let sourceMap = new SourceMap();
    sourceMap.addRawMappings(jsonmap.mappings, jsonmap.sources, jsonmap.names);

    if (map) {
      sourceMap = sourceMap.extends(map.toBuffer());
    }

    if (result.error) {
      throw result.error;
    }

    return {contents: nullthrows(result.code), map: sourceMap};
  },
});
