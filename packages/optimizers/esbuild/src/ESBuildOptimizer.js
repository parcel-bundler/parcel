// @flow

import {startService} from 'esbuild';
import {Optimizer} from '@parcel/plugin';
import {blobToString} from '@parcel/utils';
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

    let code = await blobToString(contents);

    let {js, jsSourceMap} = await service.transform(code, {
      sourcemap: true,
      sourcefile: path.relative(options.projectRoot, bundle.filePath),
      minify: true,
    });

    let sourcemap = new SourceMap();
    if (jsSourceMap) {
      let parsedMap = JSON.parse(jsSourceMap);
      sourcemap.addRawMappings(parsedMap);
      if (map) {
        sourcemap.extends(map.toBuffer());
      }

      let sourcemapReference = await getSourceMapReference(sourcemap);
      if (sourcemapReference) {
        js += `\n//# sourceMappingURL=${sourcemapReference}\n`;
      }
    }

    return {contents: js, map: sourcemap};
  },
}): Optimizer);
