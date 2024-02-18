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

    let runtimes = [];
    bundle.traverse((node) => {
      if (node.type === 'dependency' && node.value.specifier.startsWith('@parcel/rsc/resources?') && !bundleGraph.isDependencySkipped(node.value)) {
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
      } else if (node.type === 'dependency' && node.value.env.isNode()) {
        let resolvedAsset = bundleGraph.getResolvedAsset(node.value, bundle);
        if (resolvedAsset) console.log(node.value, resolvedAsset.env, resolvedAsset?.meta)
        if (resolvedAsset?.meta?.isClientComponent === true) {
          let usedSymbols = nullthrows(bundleGraph.getUsedSymbols(resolvedAsset));
          if (usedSymbols.has('*')) {
            // TODO
          }

          let code = '';
          for (let symbol of usedSymbols) {
            let resolved = bundleGraph.getSymbolResolution(resolvedAsset, symbol);
            code += `exports[${JSON.stringify(symbol)}] = {\n`;
            code += `  $$typeof: Symbol.for('react.client.reference'),\n`;
            code += `  id: ${JSON.stringify(bundleGraph.getAssetPublicId(resolved.asset))},\n`;
            code += `  name: ${JSON.stringify(resolved.exportSymbol)}\n`;
            code += `};\n`;
          }

          runtimes.push({
            filePath: resolvedAsset.filePath,
            code,
            dependency: node.value,
            env: {sourceType: 'module'},
          });
        }
      }
    });

    console.log(runtimes)
    return runtimes;
  },
}): Runtime);
