import {Transformer} from '@parcel/plugin';
import coffee from 'coffeescript';
import path from 'path';

export default new Transformer({
  transform({asset, options}) {
    let sourceFileName = path
      .relative(options.projectRoot, asset.filePath)
      .split(path.sep)
      .join('/');

    asset.type = 'js';
    let code = asset.getCode();

    // return from compile is based on sourceMap option
    if (asset.target.sourceMap) {
      let output = coffee.compile(code, {
        filename: sourceFileName,
        sourceMap: true,
      });
      asset.setCode(output.js, output.v3SourceMap || null);
    } else {
      asset.setCode(coffee.compile(code, {filename: sourceFileName}));
    }
  },
});
