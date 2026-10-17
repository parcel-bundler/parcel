// @flow
import {Transformer} from '@parcel/plugin';
import coffee from 'coffeescript';
import path from 'path';

export default (new Transformer({
  async transform({asset, options}) {
    let sourceFileName: string = path
      .relative(options.projectRoot, asset.filePath)
      .split(path.sep)
      .join('/');

    asset.type = 'js';
    let sourceMap = !!asset.target.sourceMap;
    let output = coffee.compile(await asset.getCode(), {
      filename: sourceFileName,
      sourceMap,
    });

    // return from compile is based on sourceMap option
    if (sourceMap) {
      asset.setCode(
        output.js,
        output.v3SourceMap ? JSON.parse(output.v3SourceMap) : null,
      );
    } else {
      asset.setCode(output);
    }

    return [asset];
  },
}): Transformer);
