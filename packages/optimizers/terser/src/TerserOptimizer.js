// @flow

import nullthrows from 'nullthrows';
import {minify} from 'terser';
import {Optimizer} from '@parcel/plugin';
import {loadConfig} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import path from 'path';

export default new Optimizer({
  async optimize({contents, map, bundle, options, getSourceMapReference}) {
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
    let minifiedContents: string = nullthrows(result.code);
    if (result.map && typeof result.map !== 'string') {
      sourceMap = new SourceMap();
      sourceMap.addRawMappings(
        result.map.mappings,
        result.map.sources,
        result.map.names || [],
      );
      let sourcemapReference: string = await getSourceMapReference(sourceMap);
      if (sourcemapReference) {
        minifiedContents += `\n//# sourceMappingURL=${sourcemapReference}\n`;
      }
    }

    return {contents: minifiedContents, map: sourceMap};
  },
});
