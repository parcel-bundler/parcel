// @flow

import {startService} from 'esbuild';
import {Optimizer} from '@parcel/plugin';
import {blobToString, normalizePath} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import path from 'path';

let service = null;
export default (new Optimizer({
  async optimize({contents, map, bundle, options, getSourceMapReference}) {
    if (!bundle.env.minify) {
      return {contents, map};
    }

    if (!service) {
      service = await startService();
    }

    let relativeBundlePath = path.relative(
      options.projectRoot,
      bundle.filePath,
    );
    let code = await blobToString(contents);
    if (map && options.sourceMaps) {
      let vlqMappings = map.toVLQ();
      vlqMappings = {
        ...vlqMappings,
        sources: vlqMappings.sources.map(source => normalizePath(source)),
        sourcesContent: vlqMappings.sourcesContent
          ? vlqMappings.sourcesContent.map(content =>
              content ? content : null,
            )
          : [],
        version: 3,
        file: normalizePath(relativeBundlePath + '.map'),
        sourceRoot: options.projectRoot,
      };
      code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(
        JSON.stringify(vlqMappings),
      ).toString('base64')}`;
    }

    let {js, jsSourceMap} = await service.transform(code, {
      sourcemap: options.sourceMaps,
      sourcefile: relativeBundlePath,
      minify: true,
    });

    let sourcemap = null;
    if (jsSourceMap && options.sourceMaps) {
      sourcemap = new SourceMap();
      let parsedMap = JSON.parse(jsSourceMap);
      sourcemap.addRawMappings(parsedMap);

      let sourcemapReference = await getSourceMapReference(sourcemap);
      if (sourcemapReference) {
        js += `\n//# sourceMappingURL=${sourcemapReference}\n`;
      }
    }

    return {contents: js, map: sourcemap};
  },
}): Optimizer);
