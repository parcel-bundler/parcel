// @flow strict-local

import {Packager} from '@parcel/plugin';
import fs from 'fs';
import {concat, link, generate} from '@parcel/scope-hoisting';
import SourceMap from '@parcel/source-map';
import {countLines} from '@parcel/utils';
import path from 'path';

const PRELUDE = fs
  .readFileSync(__dirname + '/prelude.js', 'utf8')
  .trim()
  .replace(/;$/, '');

export default new Packager({
  async package({bundle, bundleGraph, sourceMapPath, options}) {
    // If scope hoisting is enabled, we use a different code path.
    if (options.scopeHoist) {
      let ast = await concat(bundle, bundleGraph);
      ast = link(bundle, ast, options);
      return generate(bundle, ast, options);
    }

    // For development, we just concatenate all of the code together
    // rather then enabling scope hoisting, which would be too slow.
    let codePromises = [];
    let mapPromises = [];
    bundle.traverse(node => {
      if (node.type === 'asset') {
        codePromises.push(node.value.getCode());
        mapPromises.push(node.value.getMap());
      }
    });

    let [code, maps] = await Promise.all([
      Promise.all(codePromises),
      Promise.all(mapPromises)
    ]);

    let assets = '';
    let i = 0;
    let first = true;
    let map = new SourceMap();
    let lineOffset = countLines(PRELUDE);

    bundle.traverse(node => {
      if (node.type !== 'asset' && node.type !== 'asset_reference') {
        return;
      }

      let asset = node.value;
      if (node.type === 'asset_reference' && asset.type === 'js') {
        // if this is a reference to another javascript asset, we should not include
        // its output, as its contents should already be loaded.
        return;
      }

      let wrapped = first ? '' : ',';
      if (node.type === 'asset_reference') {
        wrapped +=
          JSON.stringify(asset.id) +
          ':[function(require,module,exports) {},{}]';
      } else {
        let deps = {};
        let dependencies = bundle.getDependencies(asset);
        for (let dep of dependencies) {
          let resolved = bundle.getDependencyResolution(dep);
          if (resolved) {
            deps[dep.moduleSpecifier] = resolved.id;
          }
        }

        let output = code[i] || '';
        wrapped +=
          JSON.stringify(asset.id) +
          ':[function(require,module,exports) {\n' +
          output +
          '\n},';
        wrapped += JSON.stringify(deps);
        wrapped += ']';

        if (options.sourceMaps) {
          let assetMap =
            maps[i] ??
            SourceMap.generateEmptyMap(
              path.relative(options.projectRoot, asset.filePath),
              output
            );

          map.addMap(assetMap, lineOffset);
          lineOffset += countLines(output) + 1;
        }

        i++;
      }

      assets += wrapped;
      first = false;

      if (node.type === 'asset_reference') {
        return;
      }
    });

    return {
      contents:
        PRELUDE +
        '({' +
        assets +
        '},{},' +
        JSON.stringify(
          bundle
            .getEntryAssets()
            .reverse()
            .map(asset => asset.id)
        ) +
        ', ' +
        'null' +
        ')\n\n' +
        '//# sourceMappingURL=' +
        sourceMapPath +
        '\n',
      map
    };
  }
});
