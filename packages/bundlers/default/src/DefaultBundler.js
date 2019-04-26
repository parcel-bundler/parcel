// @flow strict-local

import type {BundleGroup, MutableBundle} from '@parcel/types';
import {Bundler} from '@parcel/plugin';

const OPTIONS = {
  minBundles: 1,
  minBundleSize: 30000,
  maxParallelRequests: 5
};

type BundleContext = {|
  bundleGroup: BundleGroup,
  bundle?: MutableBundle
|};

export default new Bundler({
  bundle(assetGraph, bundleGraph) {
    // RULES:
    // 1. If dep.isAsync or dep.isEntry, start a new bundle group.
    // 2. If an asset is a different type than the current bundle, make a parallel bundle in the same bundle group.
    // 3. If an asset is already in a parent bundle in the same entry point, exclude from child bundles.
    // 4. If an asset is only in separate isolated entry points (e.g. workers, different HTML pages), duplicate it.
    // 5. If the sub-graph from an asset is >= 30kb, and the number of parallel requests in the bundle group is < 5, create a new bundle containing the sub-graph.
    // 6. If two assets are always seen together, put them in the same extracted bundle.

    // Step 1: create bundles for each of the explicit code split points.
    assetGraph.traverse(
      (node, context: ?BundleContext): ?BundleContext => {
        if (node.type === 'dependency') {
          let dep = node.value;

          // Start a new bundle if this is an async dependency, or entry point.
          if (dep.isAsync || dep.isEntry) {
            let isIsolated = dep.isEntry || dep.env.isIsolated();
            let resolved = assetGraph.getDependencyResolution(dep);
            if (!resolved) {
              // TODO: is this right?
              return;
            }

            let bundleGroup: BundleGroup = {
              dependency: dep,
              target: dep.target || (context && context.bundleGroup.target),
              entryAssetId: resolved.id
            };

            bundleGraph.addBundleGroup(
              isIsolated || !context ? null : context.bundle,
              bundleGroup
            );

            return {bundleGroup};
          }
        } else if (node.type === 'asset') {
          if (!context) {
            return;
          }

          let asset = node.value;

          if (asset.isIsolated) {
            let bundleGroup: BundleGroup = {
              dependency: context.bundleGroup.dependency,
              target: context.bundleGroup.target,
              entryAssetId: asset.id
            };

            bundleGraph.addBundleGroup(context.bundle, bundleGroup);
            context.bundleGroup = bundleGroup;
          }

          // If the type of this asset differs from the current bundle type,
          // start by creating a new bundle
          let typeDiffers =
            !context.bundle || asset.type !== context.bundle.type;

          if (asset.isIsolated || typeDiffers) {
            let bundle = assetGraph.createBundle(asset);
            let dep = context.bundleGroup.dependency;

            // Mark bundle as an entry, and set explicit file path from target if the dependency has one
            bundle.isEntry = asset.isIsolated ? false : !!dep.isEntry;
            let target = dep.target;
            if (
              target &&
              target.distPath != null &&
              target.distPathType === bundle.type
            ) {
              bundle.filePath = target.distPath;
            }

            // If there is a current bundle, but this asset is of a different type,
            // separate it out into a parallel bundle in the same bundle group.
            if (context.bundle) {
              // Remove this asset from the current bundle since it's of a different type.
              // `removeAsset` leaves behind an asset reference in its place.
              context.bundle.removeAsset(asset);

              let bundles = bundleGraph.getBundlesInBundleGroup(
                context.bundleGroup
              );
              let existingBundle = bundles.find(b => b.type === asset.type);

              // If there is an existing bundle of the asset's type, combine with that.
              // Otherwise, a new bundle will be created.
              if (existingBundle) {
                existingBundle.merge(bundle);
                return {
                  bundleGroup: context.bundleGroup,
                  bundle: existingBundle
                };
              }
            }

            bundleGraph.addBundle(context.bundleGroup, bundle);
            return {
              bundleGroup: context.bundleGroup,
              bundle
            };
          }
        }
      }
    );

    // Step 2: remove assets that are duplicated in a parent bundle
    bundleGraph.traverseBundles(bundle => {
      bundle.traverseAssets(asset => {
        if (bundleGraph.isAssetInAncestorBundle(bundle, asset)) {
          bundle.removeAsset(asset);
        }
      });
    });

    // Step 3: Find duplicated assets in different bundle groups, and separate them into their own parallel bundles.
    // If multiple assets are always seen together in the same bundles, combine them together.

    let candidateBundles: Map<
      string,
      {|bundle: MutableBundle, bundles: Array<MutableBundle>, size: number|}
    > = new Map();

    assetGraph.traverseAssets((asset, context, traversal) => {
      // If this asset is duplicated in the minimum number of bundles, it is a candidate to be separated into its own bundle.
      let bundles = bundleGraph.findBundlesWithAsset(asset);
      if (bundles.length > OPTIONS.minBundles) {
        let bundle = assetGraph.createBundle(asset);
        let size = bundle.getTotalSize();

        let id = bundles.map(b => b.id).join(':');
        let candidate = candidateBundles.get(id);
        if (!candidate) {
          candidateBundles.set(id, {bundles, bundle, size});
        } else {
          candidate.size += size;
          candidate.bundle.merge(bundle);
        }

        // Skip children from consideration since we added a parent already.
        traversal.skipChildren();
      }
    });

    // Sort candidates by size (consider larger bundles first), and ensure they meet the size threshold
    let sortedCandidates = Array.from(candidateBundles.values())
      .filter(bundle => bundle.size >= OPTIONS.minBundleSize)
      .sort((a, b) => b.size - a.size);

    for (let {bundle, bundles} of sortedCandidates) {
      // Find all bundle groups connected to the original bundles
      let bundleGroups = bundles.reduce(
        (arr, bundle) =>
          arr.concat(bundleGraph.getBundleGroupsContainingBundle(bundle)),
        []
      );

      // Check that all the bundle groups are inside the parallel request limit.
      if (
        !bundleGroups.every(
          group =>
            bundleGraph.getBundlesInBundleGroup(group).length <
            OPTIONS.maxParallelRequests
        )
      ) {
        continue;
      }

      // Remove all of the root assets from each of the original bundles
      for (let asset of bundle.getEntryAssets()) {
        for (let bundle of bundles) {
          bundle.removeAsset(asset);
        }
      }

      // Create new bundle node and connect it to all of the original bundle groups
      for (let bundleGroup of bundleGroups) {
        bundleGraph.addBundle(bundleGroup, bundle);
      }
    }
  }
});
