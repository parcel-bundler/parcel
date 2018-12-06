// @flow
import type {Asset, Bundle} from '@parcel/types';
import {Bundler} from '@parcel/plugin';
import Graph from '@parcel/core/src/AssetGraph';

const ISOLATED_ENVS = new Set(['web-worker', 'service-worker']);
const OPTIONS = {
  minBundleSize: 30000,
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
          // bundleGraph.addNode(bundleGroup);
          // bundleGraph.addEdge({from: isIsolated || !context ? 'root' : context.bundle.id, to: bundleGroup.id});
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
      bundleGraph.traverseAncestors(bundleNode, node => {
        if (node.type !== 'bundle') return;
        if (!node.value.hasNode(nodeId)) {
          ret = false;
          // break
        }
      });

      return ret;
    }

    // Step 3: Find duplicated assets in different bundle groups, and separate them into their own parallel bundles.
    let bundleAssetMap = new Map();
    bundleGraph.traverse(bundleGroup => {
      if (bundleGroup.type !== 'bundle_group') return;
      for (let bundle of bundleGraph.getNodesConnectedFrom(bundleGroup)) {
        for (let node of bundle.value.nodes.values()) {
          if (node.type === 'asset') {
            if (!bundleAssetMap.has(node)) {
              bundleAssetMap.set(node, new Set());
            }

            bundleAssetMap.get(node).add(bundleGroup);
          }
        }
      }
    });

    for (let [asset, bundleGroups] of bundleAssetMap) {
      if (bundleGroups.size > 1) {
        console.log(asset.value.filePath, bundleGroups.size);

        let bundle = graph.getSubGraph(asset);
        let bundleNode = {
          id: 'bundle:' + asset.id,
          type: 'bundle',
          value: bundle
        };

        for (let bundleGroup of bundleGroups) {
          for (let bundle of bundleGraph.getNodesConnectedFrom(bundleGroup)) {
            bundle.value.removeNode(asset);
          }

          bundleGraph.addBundle(bundleGroup, bundleNode);
        }
      }
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
