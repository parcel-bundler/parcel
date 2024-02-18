// @flow strict-local

import {Runtime} from '@parcel/plugin';
import {urlJoin} from '@parcel/utils';
import nullthrows from 'nullthrows';
import invariant from 'assert';

export default (new Runtime({
  apply({bundle, bundleGraph}) {
    if (bundle.env.context !== 'node') {
      return [];
    }

    let manifestAsset;
    let runtimes = [];
    bundle.traverse((node) => {
      if (
        node.type === 'dependency' &&
        node.value.specifier === '@parcel/rsc/manifest' &&
        !bundleGraph.isDependencySkipped(node.value)
      ) {
        manifestAsset = nullthrows(bundleGraph.getResolvedAsset(node.value, bundle));
      } else if (node.type === 'dependency' && node.value.specifier.startsWith('@parcel/rsc/resources?') && !bundleGraph.isDependencySkipped(node.value)) {
        let query = new URLSearchParams(node.value.specifier.split('?')[1]);
        let containingAsset = nullthrows(bundleGraph.getAssetWithDependency(node.value));
        let dep = nullthrows(bundleGraph.getDependencies(containingAsset).find(dep => dep.specifier === query.get('specifier')));
        let bundleGroup = bundleGraph.resolveAsyncDependency(dep, bundle);
        invariant(bundleGroup?.type === 'bundle_group');
        
        let asset = nullthrows(bundleGraph.getResolvedAsset(dep, bundle));
        let bundles = [];
        for (let bundle of bundleGraph.getBundlesInBundleGroup(bundleGroup.value, {includeInline: false})) {
          if (bundle.env.context === 'browser' && !bundle.getMainEntry()) {
            bundles.push(bundle);
          }
        }

        let code = 'module.exports = [\n'
        for (let bundle of bundles) {
          let url = urlJoin(bundle.target.publicUrl, bundle.name);
          code += `  {url: ${JSON.stringify(url)}, type: ${JSON.stringify(bundle.type)}},\n`;
        }
        code += '];\n';

        runtimes.push({
          filePath: asset.filePath,
          code,
          dependency: node.value,
          env: {sourceType: 'module'},
          shouldReplaceResolution: true
        });
      }
    });

    if (manifestAsset) {
      let manifest = {};
      bundleGraph.traverse(node => {
        if (node.type === 'asset') {
          let asset = node.value;
          if (asset.meta.isClientComponent === true) {
            let id = bundleGraph.getAssetPublicId(asset);
            manifest[asset.filePath] = {};
            for (let symbol of asset.symbols.exportSymbols()) {
              manifest[asset.filePath][symbol] = {
                id,
                name: symbol
              };
            }
          }
        }
      });

      let code = `import {_register} from '@parcel/rsc/manifest';
  _register(${JSON.stringify(manifest, null, 2)});
  `;

      runtimes.push({
        filePath: manifestAsset.filePath,
        code,
        isEntry: true,
        env: {sourceType: 'module'},
      });
    }

    console.log(runtimes)
    return runtimes;
  },
}): Runtime);
