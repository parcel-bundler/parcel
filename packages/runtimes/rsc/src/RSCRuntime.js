// @flow strict-local

import {Runtime} from '@parcel/plugin';
import nullthrows from 'nullthrows';

export default (new Runtime({
  apply({bundle, bundleGraph}) {
    if (bundle.type !== 'js') {
      return [];
    }

    let browserBundles = bundleGraph.getReferencedBundles(bundle)
      .filter(b => b.type === 'js' && b.env.isBrowser())
      .map(b => b.name);

    let runtimes = [];
    bundle.traverse((node) => {
      if (node.type === 'dependency') {
        let resolvedAsset = bundleGraph.getResolvedAsset(node.value, bundle);
        let directives = resolvedAsset?.meta?.directives;
        if (node.value.env.isNode() && resolvedAsset && Array.isArray(directives) && directives.includes('use client')) {
          let usedSymbols = nullthrows(bundleGraph.getUsedSymbols(resolvedAsset));
          if (usedSymbols.has('*')) {
            // TODO
          }

          let code = `import {createClientReference} from "react-server-dom-parcel/server.edge";\n`;
          for (let symbol of usedSymbols) {
            let resolved = bundleGraph.getSymbolResolution(resolvedAsset, symbol);
            code += `exports[${JSON.stringify(symbol)}] = createClientReference(${JSON.stringify(bundleGraph.getAssetPublicId(resolved.asset))}, ${JSON.stringify(resolved.exportSymbol)}, ${JSON.stringify(browserBundles)});\n`;
          }

          code += `exports.__esModule = true;\n`;

          runtimes.push({
            filePath: resolvedAsset.filePath,
            code,
            dependency: node.value,
            env: {sourceType: 'module'},
          });
        } else if (resolvedAsset && Array.isArray(directives) && directives.includes('use server')) {
          let usedSymbols = nullthrows(bundleGraph.getUsedSymbols(resolvedAsset));
          if (usedSymbols.has('*')) {
            // TODO
          }

          let code;
          if (node.value.env.isNode()) {
            // Dependency on a "use server" module from a server environment.
            // Mark each export as a server reference that can be passed to a client component as a prop.
            code = `import {registerServerReference} from "react-server-dom-parcel/server.edge";\n`;
            code += `import {requireModuleById} from "@parcel/intrinsics";\n`;
            for (let symbol of usedSymbols) {
              let resolved = bundleGraph.getSymbolResolution(resolvedAsset, symbol);
              let publicId = JSON.stringify(bundleGraph.getAssetPublicId(resolved.asset));
              let name = JSON.stringify(resolved.exportSymbol);
              code += `exports[${JSON.stringify(symbol)}] = registerServerReference(function() {
                let originalModule = requireModuleById(${publicId});
                let fn = originalModule[${name}];
                return fn.apply(this, arguments);
              }, ${publicId}, ${name});\n`;
            }
          } else {
            // Dependency on a "use server" module from a client environment.
            // Create a client proxy module that will call the server.
            code = `import {createServerReference} from "react-server-dom-parcel/client";\n`;
            for (let symbol of usedSymbols) {
              let resolved = bundleGraph.getSymbolResolution(resolvedAsset, symbol);
              code += `exports[${JSON.stringify(symbol)}] = createServerReference([${JSON.stringify(bundleGraph.getAssetPublicId(resolved.asset))}, ${JSON.stringify(resolved.exportSymbol)}]);\n`;
            }
          }
          
          code += `exports.__esModule = true;\n`;

          runtimes.push({
            filePath: resolvedAsset.filePath,
            code,
            dependency: node.value,
            env: {sourceType: 'module'},
            shouldReplaceResolution: true
          });
        }
      }
    });

    let parentBundles = bundleGraph.getParentBundles(bundle);
    let isEntry = parentBundles.length === 0 ||
      parentBundles.some(b => b.type !== 'js' || b.env.context !== bundle.env.context) ||
      bundleGraph
        .getBundleGroupsContainingBundle(bundle)
        .some(g => bundleGraph.isEntryBundleGroup(g)) ||
      bundle.env.isIsolated() ||
      bundle.bundleBehavior === 'isolated';
    if (
      bundle.env.isNode() &&
      isEntry
    ) {
      let code = 'import {registerServerActions} from "react-server-dom-parcel/server.edge";\n';
      code += `registerServerActions({\n`;
      bundleGraph.traverse(node => {
        if (node.type === 'asset' && Array.isArray(node.value.meta?.directives) && node.value.meta.directives.includes('use server')) {
          let bundlesWithAsset = bundleGraph.getBundlesWithAsset(node.value);
          let bundles = new Set();
          let referenced = bundleGraph.getReferencedBundles(bundlesWithAsset[0]);
          bundles.add(bundlesWithAsset[0].name);
          for (let r of referenced) {
            if (r.type === 'js' && r.env.context === bundle.env.context) {
              bundles.add(r.name);
            }
          }
          code += `  ${JSON.stringify(bundleGraph.getAssetPublicId(node.value))}: ${JSON.stringify([...bundles])},\n`;
        }
      });

      code += '});\n';
      runtimes.push({
        filePath: __filename,
        code,
        isEntry: true,
        env: {sourceType: 'module'},
      });
    }

    console.log(runtimes)
    return runtimes;
  },
}): Runtime);
