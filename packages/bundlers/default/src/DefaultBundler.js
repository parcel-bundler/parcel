// @flow
import type {Asset, Bundle} from '@parcel/types';
import {Bundler} from '@parcel/plugin';
import Graph from '@parcel/core/src/AssetGraph';

const ISOLATED_ENVS = new Set(['web-worker', 'service-worker']);
const OPTIONS = {
  minBundles: 1,
  minBundleSize: 10000,
  maxParallelRequests: 5
};

class BundleGraph extends Graph {
  constructor() {
    super();
    this.setRootNode({
      type: 'root',
      id: 'root',
      value: null
    });
  }

  addBundleGroup(parentBundleNode, dep) {
    let bundleGroup = {
      id: 'bundle_group:' + dep.id,
      type: 'bundle_group',
      value: null
    };

    // Add a connection from the dependency to the new bundle group in all bundles
    this.traverse(bundle => {
      if (bundle.type === 'bundle') {
        let depNode = bundle.value.assetGraph.getNode(dep.id);
        if (depNode) {
          bundle.value.assetGraph.replaceNodesConnectedTo(depNode, [
            bundleGroup
          ]);
        }
      }
    });

    this.addNode(bundleGroup);
    this.addEdge({
      from: !parentBundleNode ? 'root' : parentBundleNode.id,
      to: bundleGroup.id
    });

    return bundleGroup;
  }

  addBundle(bundleGroup, bundle, id) {
    let bundleNode = {
      id: id,
      type: 'bundle',
      value: bundle
    };

    this.addNode(bundleNode);
    this.addEdge({
      from: bundleGroup.id,
      to: bundleNode.id
    });

    // Add a connection from the bundle group to the bundle in all bundles
    this.traverse(node => {
      if (
        node.type === 'bundle' &&
        node.value.assetGraph.hasNode(bundleGroup.id)
      ) {
        node.value.assetGraph.addNode(bundleNode);
        node.value.assetGraph.addEdge({
          from: bundleGroup.id,
          to: bundleNode.id
        });
      }
    });

    return bundleNode;
  }

  isAssetInAncestorBundle(bundle, asset) {
    let ret = null;
    this.traverseAncestors(bundle, (node, context, traversal) => {
      // Skip starting node
      if (node === bundle) {
        return;
      }

      // If this is the first bundle we've seen, initialize result to true
      if (node.type === 'bundle' && ret === null) {
        ret = true;
      }

      if (node.type === 'bundle' && !node.value.assetGraph.hasNode(asset.id)) {
        ret = false;
        traversal.stop();
      }
    });

    return !!ret;
  }

  findBundlesWithAsset(asset) {
    return Array.from(this.nodes.values()).filter(
      node => node.type === 'bundle' && node.value.assetGraph.hasNode(asset.id)
    );
  }
}

export default new Bundler({
  async bundle(graph) {
    // RULES
    // 1. If dep.isAsync or dep.isEntry, start a new bundle.
    // 2. If an asset has been seen before in a different bundle:
    //    a. If the asset is already in a parent bundle in the same entry point, exclude from the current bundle.
    //    b. If the asset is only in separate isolated entry points (e.g. workers, different HTML pages), duplicate it.
    //    c. If the sub-graph from this asset is >= 30kb, and the number of parallel requests at the current entry point is < 5, create a new bundle containing the sub-graph.
    //    d. Else, hoist the asset to the nearest common ancestor.

    let bundleGraph = new BundleGraph();

    // Step 1: create bundles for each of the explicit code split points.
    graph.traverse((node, context) => {
      if (node.type === 'dependency') {
        let dep = node.value;
        if (dep.isAsync || dep.isEntry) {
          let isIsolated =
            !context || dep.isEntry || ISOLATED_ENVS.has(dep.env.context);
          let bundleGroup = bundleGraph.addBundleGroup(
            isIsolated ? null : context.bundle,
            dep
          );

          return {bundleGroup};
        }
      } else if (node.type === 'asset') {
        if (!context.bundle || node.value.type !== context.bundle.value.type) {
          let bundle = graph.createBundle(node.value);

          // If there is a current bundle, but this asset is of a different type,
          // separate it out into a different bundle.
          if (context.bundle) {
            let bundles = bundleGraph.getNodesConnectedFrom(
              context.bundleGroup
            );
            let existingBundle = bundles.find(
              b => b.value.type === node.value.type
            );

            // If there is an existing bundle of the asset's type, combine with that.
            // Otherwise, a new bundle will be created.
            if (existingBundle) {
              existingBundle.value.assetGraph.merge(bundle);
              return {bundleGroup: context.bundleGroup, bundle: existingBundle};
            }
          }

          let bundleNode = bundleGraph.addBundle(
            context.bundleGroup,
            bundle,
            'bundle:' + node.id
          );
          return {bundleGroup: context.bundleGroup, bundle: bundleNode};
        }
      }
    });

    // Step 2: remove assets that are duplicated in a parent bundle
    bundleGraph.traverse(node => {
      if (node.type !== 'bundle') return;

      let assetGraph = node.value.assetGraph;
      assetGraph.traverseAssets(asset => {
        if (bundleGraph.isAssetInAncestorBundle(node, asset)) {
          console.log('dup', asset);
          assetGraph.removeAsset(asset);
        }
      });
    });

    // Step 3: Find duplicated assets in different bundle groups, and separate them into their own parallel bundles.
    // If multiple assets are always seen together in the same bundles, combine them together.

    let candidateBundles = new Map();

    graph.traverseAssets((asset, context, traversal) => {
      // If this asset is duplicated in the minimum number of bundles, it is a candidate to be separated into its own bundle.
      let bundles = bundleGraph.findBundlesWithAsset(asset);
      if (bundles.length > OPTIONS.minBundles) {
        console.log('dup', asset.filePath);

        let bundle = graph.createBundle(asset);
        let size = bundle.assetGraph.getTotalSize();

        let id = bundles.map(b => b.id).join(':');
        let candidate = candidateBundles.get(id);
        if (!candidate) {
          candidateBundles.set(id, {id, bundles, bundle, size});
        } else {
          candidate.size += size;
          candidate.bundle.assetGraph.merge(bundle.assetGraph);
        }

        // Skip children from consideration since we added a parent already.
        traversal.skipChildren();
      }
    });

    // Sort candidates by size (consider larger bundles first), and ensure they meet the threshold
    let sortedCandidates = Array.from(candidateBundles.values())
      .filter(bundle => bundle.size >= OPTIONS.minBundleSize)
      .sort((a, b) => b.size - a.size);

    for (let {id, bundle, bundles} of sortedCandidates) {
      // Find all bundle groups connected to the original bundles
      let bundleGroups = bundles.reduce(
        (arr, bundle) => arr.concat(bundleGraph.getNodesConnectedTo(bundle)),
        []
      );

      // Check that all the bundle groups are inside the parallel request limit.
      if (
        !bundleGroups.every(
          group =>
            bundleGraph.getNodesConnectedFrom(group).length <
            OPTIONS.maxParallelRequests
        )
      ) {
        continue;
      }

      // Remove all of the root assets from each of the original bundles
      for (let asset of bundle.assetGraph.getEntryAssets()) {
        for (let bundle of bundles) {
          bundle.value.assetGraph.removeAsset(asset);
        }
      }

      // Create new bundle node and connect it to all of the original bundle groups
      for (let bundleGroup of bundleGroups) {
        bundleGraph.addBundle(bundleGroup, bundle, id);
      }
    }

    bundleGraph.dumpGraphViz();

    bundleGraph.traverse(bundle => {
      if (bundle.type === 'bundle') {
        bundle.value.assetGraph.dumpGraphViz();
      }
    });

    return bundleGraph;
  }
});
