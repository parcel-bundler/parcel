// @flow strict-local

import {Runtime} from '@parcel/plugin';
import {urlJoin} from '@parcel/utils';
import nullthrows from 'nullthrows';

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
      } else if (node.type === 'dependency' && node.value.specifier === '@parcel/rsc/resources' && !bundleGraph.isDependencySkipped(node.value)) {
        let asset = nullthrows(bundleGraph.getResolvedAsset(node.value, bundle));
        let bundles = [];
        for (let bundle of bundleGraph.getBundlesWithDependency(node.value)) {
          for (let bundleGroup of bundleGraph.getBundleGroupsContainingBundle(bundle)) {
            for (let bundle of bundleGraph.getBundlesInBundleGroup(bundleGroup, {includeInline: false})) {
              if (bundle.env.context === 'browser' && !bundle.getMainEntry()) {
                bundles.push(bundle);
              }
            }
          }
        }

        let code = 'export function Resources() {\n  return [\n';
        for (let bundle of bundles) {
          let url = urlJoin(bundle.target.publicUrl, bundle.name);
          if (bundle.type === 'css') {
            code += `    <link rel="stylesheet" href={'${url}'} precedence="default" />,\n`
          } else if (bundle.type === 'js') {
            code += `    <script type="module" src={'${url}'} />,\n`
          }
        }
        code += '  ];\n}\n';

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
            let bundles = [];
            for (let bundle of bundleGraph.getBundlesWithAsset(asset)) {
              for (let bundleGroup of bundleGraph.getBundleGroupsContainingBundle(bundle)) {
                for (let bundle of bundleGraph.getBundlesInBundleGroup(bundleGroup, {includeInline: false})) {
                  if (bundle.env.context === 'browser' && !bundle.getMainEntry()) {
                    bundles.push(bundle);
                  }
                }
              }
            }
            // let bundles = bundleGraph.getReferencedBundles(b, {recursive: true});
            let chunks = bundles.map(b => urlJoin(b.target.publicUrl, b.name));
            for (let symbol of asset.symbols.exportSymbols()) {
              manifest[asset.filePath + '#' + symbol] = {
                id,
                chunks,
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
