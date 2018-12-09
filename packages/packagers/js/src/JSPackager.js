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
    let promises = [];
    bundle.assetGraph.traverseAssets(asset => {
      promises.push(asset.getOutput());
    });
    let outputs = await Promise.all(promises);

    let assets = '';
    let i = 0;
    bundle.assetGraph.traverseAssets(asset => {
      let deps = {};

      let dependencies = bundle.assetGraph.getNodesConnectedFrom(asset);
      for (let dep of dependencies) {
        let node = bundle.assetGraph.getNodesConnectedFrom(dep)[0];
        if (node.type === 'transformer_request') {
          let assetNode = bundle.assetGraph
            .getNodesConnectedFrom(node)
            .find(
              node => node.type === 'asset' || node.type === 'asset_reference'
            );
          if (assetNode) {
            deps[dep.value.moduleSpecifier] = assetNode.value.id;
          }
        } else if (node.type === 'bundle_group') {
          let bundles = bundle.assetGraph.getNodesConnectedFrom(node);
          deps[dep.value.moduleSpecifier] = bundles.map(b => b.id);
        }
      }

      let output = outputs[i];
      let wrapped = i === 0 ? '' : ',';
      wrapped +=
        JSON.stringify(asset.id) +
        ':[function(require,module,exports) {\n' +
        (output.code || '') +
        '\n},';
      wrapped += JSON.stringify(deps);
      wrapped += ']';

      i++;
      assets += wrapped;
    });

    return (
      PRELUDE +
      '({' +
      assets +
      '},{},' +
      JSON.stringify(
        bundle.assetGraph
          .getNodesConnectedFrom(bundle.assetGraph.getRootNode())
          .map(node => node.id)
      ) +
      ', ' +
      'null' +
      ')'
    );
  }
});
