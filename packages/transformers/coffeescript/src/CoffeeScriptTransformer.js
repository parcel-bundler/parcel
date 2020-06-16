// @flow
import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';
import coffee from 'coffeescript';
import {relativeUrl} from '@parcel/utils';

export default new Transformer({
  async transform({asset, options}) {
    let sourceFileName: string = relativeUrl(
      options.projectRoot,
      asset.filePath,
    );

    asset.type = 'js';
    let output = coffee.compile(await asset.getCode(), {
      filename: sourceFileName,
      sourceMap: options.sourceMaps,
    });

    // return from compile is based on sourceMaps option
    if (options.sourceMaps) {
      let map = null;
      if (output.v3SourceMap) {
        map = new SourceMap();
        map.addRawMappings(JSON.parse(output.v3SourceMap));
      }

      asset.setCode(output.js);
      asset.setMap(map);
    } else {
      asset.setCode(output);
    }

    return [asset];
  },
});
