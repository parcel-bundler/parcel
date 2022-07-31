// @flow

import nullthrows from 'nullthrows';
import {minify} from '@swc/core';
import {Optimizer} from '@parcel/plugin';
import {blobToString} from '@parcel/utils';
import SourceMap from '@parcel/source-map';

import path from 'path';

export default (new Optimizer({
  async loadConfig({config, options}) {
    let userConfig = await config.getConfigFrom(
      path.join(options.projectRoot, 'index'),
      ['.terserrc', '.terserrc.js', '.terserrc.cjs'],
    );

    if (userConfig) {
      let isJavascript = path.extname(userConfig.filePath) === '.js';
      if (isJavascript) {
        config.invalidateOnStartup();
      }
    }

    return userConfig?.contents;
  },
  async optimize({
    contents,
    map: originalMap,
    bundle,
    config: userConfig,
    options,
    getSourceMapReference,
  }) {
    if (!bundle.env.shouldOptimize) {
      return {contents, map: originalMap};
    }

    let code = await blobToString(contents);
    let config = {
      mangle: true,
      compress: true,
      ...userConfig,
      sourceMap: bundle.env.sourceMap
        ? {
            filename: path.relative(
              options.projectRoot,
              path.join(bundle.target.distDir, bundle.name),
            ),
          }
        : false,
      toplevel:
        bundle.env.outputFormat === 'esmodule' ||
        bundle.env.outputFormat === 'commonjs',
      module: bundle.env.outputFormat === 'esmodule',
    };

    let result = await minify(code, config);

    let sourceMap = null;
    let minifiedContents: string = nullthrows(result.code);
    let resultMap = result.map;
    if (resultMap) {
      sourceMap = new SourceMap(options.projectRoot);
      sourceMap.addVLQMap(JSON.parse(resultMap));
      if (originalMap) {
        sourceMap.extends(originalMap);
      }
      let sourcemapReference = await getSourceMapReference(sourceMap);
      if (sourcemapReference) {
        minifiedContents += `\n//# sourceMappingURL=${sourcemapReference}\n`;
      }
    }

    return {contents: minifiedContents, map: sourceMap};
  },
}): Optimizer);
