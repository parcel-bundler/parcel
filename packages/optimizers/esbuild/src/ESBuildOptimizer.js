// @flow

import {transform} from 'esbuild';
import {Optimizer} from '@atlaspack/plugin';
import {blobToString, normalizePath} from '@atlaspack/utils';
import SourceMap from '@parcel/source-map';
import path from 'path';
import invariant from 'assert';

export default (new Optimizer({
  async optimize({contents, map, bundle, options, getSourceMapReference}) {
    if (!bundle.env.shouldOptimize) {
      return {contents, map};
    }

    let relativeBundlePath = path.relative(
      options.projectRoot,
      path.join(bundle.target.distDir, bundle.name),
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

    let {code: js, map: jsSourceMap} = await transform(code, {
      sourcemap: 'external',
      sourcefile: relativeBundlePath,
      minify: true,
      treeShaking: true,
      format: 'esm',
    });

    let sourcemap = null;
    if (jsSourceMap) {
      sourcemap = new SourceMap(options.projectRoot);
      let parsedMap = JSON.parse(jsSourceMap);
      sourcemap.addVLQMap(parsedMap);

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
