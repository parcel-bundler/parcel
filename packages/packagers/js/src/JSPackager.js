// @flow
'use strict';

import {Packager} from '@parcel/plugin';
import fs from 'fs';
import path from 'path';

const PRELUDE = fs
  .readFileSync(__dirname + '/prelude.js', 'utf8')
  .trim()
  .replace(/;$/, '');

export default new Packager({
  async package(bundle) {
    let promises = [];
    bundle.assetGraph.traverseAssets(asset => {
      promises.push(asset.getOutput());
    });
    let outputs = await Promise.all(promises);

    let assets = '';
    let i = 0;
    let first = true;
    bundle.assetGraph.traverseAssets(asset => {
      let deps = {};

      let dependencies = bundle.assetGraph.getDependencies(asset);
      for (let dep of dependencies) {
        let resolved = bundle.assetGraph.getDependencyResolution(dep);
        if (resolved.bundles) {
          // deps[dep.moduleSpecifier] = resolved.bundles.map(b => [b.loader, path.basename(b.filePath)]);
          deps[dep.moduleSpecifier] = resolved.bundleGroupId;
          writeBundleGroup(resolved.bundleGroupId, resolved.bundles, resolved.runtime, resolved.entryAssetId);
        } else if (resolved.asset) {
          deps[dep.moduleSpecifier] = resolved.asset.id;
        }
      }

      writeModule(asset.id, outputs[i].code, deps);
      i++;
    });

    function writeBundleGroup(id, bundles, runtime, entry) {
      let code = `module.exports = require('${runtime}')(${JSON.stringify(bundles.map(b => [b.loader, path.basename(b.filePath)]).concat(entry))});`;
      writeModule(id, code, {});
    }

    function writeModule(id, code, deps) {
      let wrapped = first ? '' : ',';
      wrapped +=
        JSON.stringify(id) +
        ':[function(require,module,exports) {\n' +
        (code || '') +
        '\n},';
      wrapped += JSON.stringify(deps);
      wrapped += ']';

      first = false;
      assets += wrapped;
    }

    return (
      PRELUDE +
      '({' +
      assets +
      '},{},' +
      JSON.stringify(
        bundle.assetGraph.getEntryAssets().map(asset => asset.id)
      ) +
      ', ' +
      'null' +
      ')'
    );
  }
});
