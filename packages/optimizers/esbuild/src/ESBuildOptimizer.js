// @flow

import {startService} from 'esbuild';
import {Optimizer} from '@parcel/plugin';
import {blobToString, normalizePath} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import path from 'path';
import invariant from 'assert';

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
    if (map) {
      let vlqMappings = await map.stringify({
        file: normalizePath(relativeBundlePath + '.map'),
        format: 'inline',
      });
      // Flow things...
      invariant(typeof vlqMappings === 'string');
      code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${vlqMappings}`;
    }

    let {code: js, map: jsSourceMap} = await service.transform(code, {
      sourcemap: 'external',
      sourcefile: relativeBundlePath,
      minify: true,
    });

    let sourcemap = null;
    if (jsSourceMap) {
      sourcemap = new SourceMap(options.projectRoot);
      let parsedMap = JSON.parse(jsSourceMap);
      sourcemap.addRawMappings(parsedMap);

      let sourcemapReference = await getSourceMapReference(sourcemap);
      if (sourcemapReference) {
        js += `\n//# sourceMappingURL=${sourcemapReference}\n`;
      }
    }

    return {
      contents: js,
      map: sourcemap || map,
    };
  },
}): Optimizer);
