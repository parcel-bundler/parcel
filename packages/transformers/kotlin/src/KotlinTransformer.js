// @flow
import {Transformer} from '@parcel/plugin';
import {md5FromString} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import path from 'path';
import os from 'os';

export default new Transformer({
  async transform({asset, options}) {
    asset.type = 'js';

    // require kotlin
    const kotlinCompiler = await options.packageManager.require(
      '@jetbrains/kotlinc-js-api',
      asset.filePath
    );

    let id = md5FromString(asset.filePath);
    let tmpKotlinDist = path.join(os.tmpdir(), 'kotlin-dist');
    let filename = path.join(tmpKotlinDist, id + '.js');

    await kotlinCompiler.compile({
      output: filename,
      sources: [asset.filePath],
      moduleKind: 'commonjs',
      noStdlib: false,
      metaInfo: true,
      sourceMaps: options.sourceMaps
    });

    let code = await asset.fs.readFile(filename, 'utf8');
    if (options.sourceMaps) {
      let rawSourceMap = await asset.fs.readFile(filename + '.map', 'utf8');

      rawSourceMap = JSON.parse(rawSourceMap);

      // TODO: Actually do this for all sources?
      rawSourceMap.sources = [path.relative(options.rootDir, asset.filePath)];
      // Fetch these at bundle time...
      rawSourceMap.sourcesContent = [];

      let sourcemap = await SourceMap.fromRawSourceMap(rawSourceMap);

      asset.setMap(sourcemap);

      // remove source map url
      code = code.substring(0, code.lastIndexOf('//# sourceMappingURL'));
    }

    asset.setCode(code);

    try {
      // try to delete tmp directory
      await asset.fs.rimraf(tmpKotlinDist);
    } catch (e) {
      // do nothing...
    }

    return [asset];
  }
});
