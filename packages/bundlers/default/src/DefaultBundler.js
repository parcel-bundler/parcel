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
      id: 'root'
    });
  }

  addBundleGroup(parentBundleNode, bundleGroup) {
    this.addNode(bundleGroup);
    this.addEdge({
      from: !parentBundleNode ? 'root' : parentBundleNode.id,
      to: bundleGroup.id
    });
  }

  addBundle(bundleGroup, bundle) {
    this.addNode(bundle);
    this.addEdge({
      from: bundleGroup.id,
      to: bundle.id
    });

    this.traverse(node => {
      if (node.type === 'bundle' && node.value.hasNode(bundleGroup.id)) {
        node.value.addNode(bundle);
        node.value.addEdge({
          from: bundleGroup.id,
          to: bundle.id
        });
      }
    });
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
          let bundleGroup = {
            id: 'bundle_group' + dep.id,
            type: 'bundle_group',
            value: ''
          };

          if (context) {
            bundleGraph.traverseAncestors(context.bundle, bundle => {
              if (bundle.type === 'bundle') {
                bundle.value.replaceNodesConnectedTo(node, [bundleGroup]);
              }
            });
          }

          let isIsolated =
            !context || dep.isEntry || ISOLATED_ENVS.has(dep.env.context);
          bundleGraph.addBundleGroup(
            isIsolated ? null : context.bundle,
            bundleGroup
          );

          context = {bundleGroup};
        }
      } else if (node.type === 'asset') {
        let bundles = bundleGraph.getNodesConnectedFrom(context.bundleGroup);
        if (
          !context.bundle ||
          node.value.type !== context.bundle.value.getRootNode().value.type
        ) {
          let bundle = graph.getSubGraph(node);
          let bundleNode = {
            id: 'bundle:' + node.id,
            type: 'bundle',
            value: bundle
          };

          bundleGraph.addBundle(context.bundleGroup, bundleNode);

          context = {bundleGroup: context.bundleGroup, bundle: bundleNode};
        }
      }

      return context;
    });

    // Step 2: remove assets that are duplicated in a parent bundle
    bundleGraph.traverse(node => {
      if (node.type !== 'bundle') return;

      let bundle = node.value;
      for (let assetNode of bundle.nodes.values()) {
        if (
          assetNode.type === 'asset' &&
          hasNode(node, assetNode.id) &&
          assetNode !== bundle.getRootNode()
        ) {
          console.log('dup', assetNode);
          bundle.removeNode(assetNode);
        }
      }
    });

    function hasNode(bundleNode, nodeId) {
      let ret = true;
      bundleGraph.traverseAncestors(bundleNode, (node, context, traversal) => {
        if (node.type === 'bundle' && !node.value.hasNode(nodeId)) {
          ret = false;
          traversal.stop();
        }
      });

      return ret;
    }

    // Step 3: Find duplicated assets in different bundle groups, and separate them into their own parallel bundles.
    // If multiple assets are always seen together in the same bundles, combine them together.

    let candidateBundles = new Map();

    graph.traverse((assetNode, context, traversal) => {
      if (assetNode.type === 'asset') {
        let bundles = Array.from(bundleGraph.nodes.values()).filter(
          node => node.type === 'bundle' && node.value.hasNode(assetNode.id)
        );

        // If this asset is duplicated in the minimum number of bundles, it is a candidate to be separated into its own bundle.
        if (bundles.length > OPTIONS.minBundles) {
          console.log('dup', assetNode.value.filePath);

          let bundle = graph.getSubGraph(assetNode);
          let size = getSize(bundle);

          let id = bundles.map(b => b.id).join(':');
          let candidate = candidateBundles.get(id);
          if (!candidate) {
            bundle.setRootNode({
              type: 'root',
              id: 'root'
            });

            bundle.addEdge({from: 'root', to: assetNode.id});

            candidateBundles.set(id, {id, bundles, bundle, size});
          } else {
            candidate.size += size;
            candidate.bundle.merge(bundle);
            candidate.bundle.addEdge({from: 'root', to: assetNode.id});
          }

          // Skip children from consideration since we added a parent already.
          traversal.skipChildren();
        }
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
        return;
      }

      // Remove all of the root assets from each of the original bundles
      for (let asset of bundle.getNodesConnectedFrom(bundle.getRootNode())) {
        for (let bundle of bundles) {
          bundle.value.removeNode(asset);
        }
      }

      // Create new bundle node and connect it to all of the original bundle groups
      let bundleNode = {
        id: id,
        type: 'bundle',
        value: bundle
      };

      for (let bundleGroup of bundleGroups) {
        bundleGraph.addBundle(bundleGroup, bundleNode);
      }
    }

    function getSize(graph) {
      let size = 0;
      for (let node of graph.nodes.values()) {
        if (node.type === 'asset') {
          size += node.value.outputSize;
        }
      }

      return size;
    }

    bundleGraph.dumpGraphViz();

    bundleGraph.traverse(bundle => {
      if (bundle.type === 'bundle') {
        bundle.value.dumpGraphViz();
      }
    });

    // console.log(bundles);
    throw 'stop';
    return bundles;

    // let assets = Array.from(graph.nodes.values())
    //   .filter(node => node.type === 'asset')
    //   .map(node => node.value);

    // return [
    //   {
    //     type: 'js',
    //     filePath: 'bundle.js',
    //     assets
    //   }
    // ];
  }
});
