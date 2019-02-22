// @flow
'use strict';

import {Packager} from '@parcel/plugin';
import fs from 'fs';
import {concat, link, generate} from '@parcel/scope-hoisting';

const PRELUDE = fs
  .readFileSync(__dirname + '/prelude.js', 'utf8')
  .trim()
  .replace(/;$/, '');

export default new Packager({
  async package(bundle, options) {
    let ast = await concat(bundle, options);
    ast = link(bundle, ast, options);
    return generate(bundle, ast, options);

    // let promises = [];
    // bundle.assetGraph.traverseAssets(asset => {
    //   promises.push(asset.getOutput());
    // });
    // let outputs = await Promise.all(promises);

    // let assets = '';
    // let i = 0;
    // bundle.assetGraph.traverseAssets(asset => {
    //   let deps = {};

    //   let dependencies = bundle.assetGraph.getDependencies(asset);
    //   for (let dep of dependencies) {
    //     let resolved = bundle.assetGraph.getDependencyResolution(dep);
    //     if (resolved) {
    //       deps[dep.moduleSpecifier] = resolved.id;
    //     }
    //   }

    //   let output = outputs[i];
    //   let wrapped = i === 0 ? '' : ',';
    //   wrapped +=
    //     JSON.stringify(asset.id) +
    //     ':[function(require,module,exports) {\n' +
    //     (output.code || '') +
    //     '\n},';
    //   wrapped += JSON.stringify(deps);
    //   wrapped += ']';

    //   i++;
    //   assets += wrapped;
    // });

    // return (
    //   PRELUDE +
    //   '({' +
    //   assets +
    //   '},{},' +
    //   JSON.stringify(
    //     bundle.assetGraph.getEntryAssets().map(asset => asset.id)
    //   ) +
    //   ', ' +
    //   'null' +
    //   ')'
    // );
  }
});
