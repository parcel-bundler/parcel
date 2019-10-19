// @flow strict-local

import {Runtime} from '@parcel/plugin';

export default new Runtime({
  apply({bundle, bundleGraph}) {
    if (bundle.env.context !== 'service-worker') {
      return;
    }

    let map = {};
    bundleGraph.traverseBundles(bundle => {
      // console.log(bundle.filePath);
      map[bundle.name] = bundle.getHash().slice(-8);
    });

    console.log(bundle.name, map);

    let code = `
      var manifest = ${JSON.stringify(map, false, 2)};
      console.log(manifest);
    `;

    return [
      {
        filePath: __filename,
        code
      }
    ];
  }
});
