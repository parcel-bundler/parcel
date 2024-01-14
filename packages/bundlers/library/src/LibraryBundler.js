// @flow strict-local
import {Bundler} from '@parcel/plugin';
import nullthrows from 'nullthrows';

export default (new Bundler({
  bundle({bundleGraph}) {
    let bundles = new Map();
    bundleGraph.traverse((node, context) => {
      if (node.type === 'dependency') {
        let dependency = node.value;
        let parentAsset = bundleGraph.getAssetWithDependency(dependency);
        let assets = bundleGraph.getDependencyAssets(dependency);

        // Create a separate bundle group/bundle for each asset.
        for (let asset of assets) {
          let target = nullthrows(dependency.target ?? context);
          let bundleGroup = bundleGraph.createBundleGroup(dependency, target);
          let bundle = bundleGraph.createBundle({
            entryAsset: asset,
            needsStableName: !parentAsset,
            target,
          });
          bundleGraph.addAssetToBundle(asset, bundle);
          bundleGraph.addBundleToBundleGroup(bundle, bundleGroup);

          // Reference the parent bundle so we create dependencies between them.
          let parentBundle = parentAsset && bundles.get(parentAsset);
          if (parentBundle) {
            bundleGraph.createBundleReference(parentBundle, bundle);
          }
          bundles.set(asset, bundle);
        }

        if (dependency.target) {
          return dependency.target;
        }
      }
    });
  },
  optimize() {},
}): Bundler);
