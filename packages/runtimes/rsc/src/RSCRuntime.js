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
      if (node.type === 'dependency' && node.value.specifier.startsWith('@parcel/runtime-rsc/resources?id=') && !bundleGraph.isDependencySkipped(node.value)) {
        let query = new URLSearchParams(node.value.specifier.split('?')[1]);
        let dep = bundleGraph.getDependencyById(nullthrows(query.get('id')));
        let bundleGroup = bundleGraph.resolveAsyncDependency(dep, bundle);
        invariant(bundleGroup?.type === 'bundle_group');
        
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
          filePath: __filename,
          code,
          dependency: node.value,
          env: {sourceType: 'module'},
          shouldReplaceResolution: true
        });
      } else if (node.type === 'dependency' && node.value.env.isNode()) {
        let resolvedAsset = bundleGraph.getResolvedAsset(node.value, bundle);
        let directives = resolvedAsset?.meta?.directives;
        if (resolvedAsset && Array.isArray(directives) && directives.includes('use client')) {
          let usedSymbols = nullthrows(bundleGraph.getUsedSymbols(resolvedAsset));
          if (usedSymbols.has('*')) {
            // TODO
          }

          let code = '';
          for (let symbol of usedSymbols) {
            let resolved = bundleGraph.getSymbolResolution(resolvedAsset, symbol);
            code += `exports[${JSON.stringify(symbol)}] = {\n`;
            code += `  $$typeof: Symbol.for('react.client.reference'),\n`;
            code += `  $$id: ${JSON.stringify(bundleGraph.getAssetPublicId(resolved.asset))},\n`;
            code += `  $$name: ${JSON.stringify(resolved.exportSymbol)}\n`;
            code += `};\n`;
          }

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

          let code = `function bind(_, ...args) {
            let f = Function.prototype.bind.call(this, arguments);
            f.$$typeof = this.$$typeof;
            f.$$id = this.$$id;
            f.$$name = this.$$name;
            f.$$bound = (f.$$bound || []).concat(args);
            f.bind = bind;
            return f;
          };\n`;
          let count = 0;
          for (let symbol of usedSymbols) {
            let resolved = bundleGraph.getSymbolResolution(resolvedAsset, symbol);
            let name = `_${++count}`;
            code += `function ${name}() {}\n`;
            code += `${name}.$$typeof = Symbol.for('react.server.reference');\n`;
            code += `${name}.$$id = ${JSON.stringify(bundleGraph.getAssetPublicId(resolved.asset))};\n`;
            code += `${name}.$$name = ${JSON.stringify(resolved.exportSymbol)};\n`;
            code += `${name}.$$bound = null;\n`;
            code += `${name}.bind = bind;\n`;
            code += `exports[${JSON.stringify(symbol)}] = ${name};\n`;
          }

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

    console.log(runtimes)
    return runtimes;
  },
}): Runtime);
