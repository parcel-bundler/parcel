// @flow

import nullthrows from 'nullthrows';
import {minify} from 'terser';
import {Optimizer} from '@parcel/plugin';
import {blobToString, loadConfig} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import ThrowableDiagnostic from '@parcel/diagnostic';

import path from 'path';

export default (new Optimizer({
  async optimize({contents, map, bundle, options, getSourceMapReference}) {
    if (!bundle.env.shouldOptimize) {
      return {contents, map};
    }

    let code = await blobToString(contents);

    let userConfig = await loadConfig(
      options.inputFS,
      path.join(options.entryRoot, 'index'),
      ['.terserrc', '.uglifyrc', '.uglifyrc.js', '.terserrc.js'],
    );

    let originalMap = map ? await map.stringify({}) : null;
    let config = {
      ...userConfig?.config,
      sourceMap: bundle.env.sourceMap
        ? {
            filename: path.relative(options.projectRoot, bundle.filePath),
            asObject: true,
            content: originalMap,
          }
        : false,
      toplevel:
        bundle.env.outputFormat === 'esmodule' ||
        bundle.env.outputFormat === 'commonjs',
      module: bundle.env.outputFormat === 'esmodule',
    };

    let result;
    try {
      result = await minify(code, config);
    } catch (error) {
      // $FlowFixMe
      let {message, line, col} = error;
      if (line != null && col != null) {
        let diagnostics = [];
        let mapping = map?.findClosestMapping(line, col);
        if (mapping && mapping.original && mapping.source) {
          let {source, original} = mapping;
          let filePath = path.resolve(options.projectRoot, source);
          diagnostics.push({
            message,
            origin: '@parcel/optimizer-terser',
            language: 'js',
            filePath,
            codeFrame: {
              code: await options.inputFS.readFile(filePath, 'utf8'),
              codeHighlights: [{message, start: original, end: original}],
            },
            hints: ["It's likely that Terser doesn't support this syntax yet."],
          });
        }

        if (diagnostics.length === 0 || options.logLevel === 'verbose') {
          let loc = {
            line: line,
            column: col,
          };
          diagnostics.push({
            message,
            origin: '@parcel/optimizer-terser',
            language: 'js',
            filePath: undefined,
            codeFrame: {
              code,
              codeHighlights: [{message, start: loc, end: loc}],
            },
            hints: ["It's likely that Terser doesn't support this syntax yet."],
          });
        }
        throw new ThrowableDiagnostic({diagnostic: diagnostics});
      } else {
        throw error;
      }
    }

    let sourceMap = null;
    let minifiedContents: string = nullthrows(result.code);
    if (result.map && typeof result.map !== 'string') {
      sourceMap = new SourceMap(options.projectRoot);
      sourceMap.addRawMappings(result.map);
      let sourcemapReference = await getSourceMapReference(sourceMap);
      if (sourcemapReference) {
        minifiedContents += `\n//# sourceMappingURL=${sourcemapReference}\n`;
      }
    }

    return {contents: minifiedContents, map: sourceMap};
  },
}): Optimizer);
