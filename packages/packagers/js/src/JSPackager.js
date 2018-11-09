// @flow
'use strict';

import {Packager} from '@parcel/plugin';
import fs from 'fs';

const PRELUDE = fs
  .readFileSync(__dirname + '/prelude.js', 'utf8')
  .trim()
  .replace(/;$/, '');

export default new Packager({
  async package(bundle) {
    let assets = bundle.assets
      .map((asset, i) => {
        let deps = {};

        for (let dep of asset.dependencies) {
          let resolvedAsset = bundle.assets.find(
            a => a.filePath === dep.resolvedPath
          );
          deps[dep.moduleSpecifier] = resolvedAsset.id;
        }

        let wrapped = i === 0 ? '' : ',';
        wrapped +=
          JSON.stringify(asset.id) +
          ':[function(require,module,exports) {\n' +
          (asset.output.code || '') +
          '\n},';
        wrapped += JSON.stringify(deps);
        wrapped += ']';

        return wrapped;
      })
      .join('');

    return (
      PRELUDE +
      '({' +
      assets +
      '},{},' +
      JSON.stringify([bundle.assets[0].id]) +
      ', ' +
      'null' +
      ')'
    );
  }
});
