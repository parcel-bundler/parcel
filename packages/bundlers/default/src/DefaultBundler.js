// @flow
import type {Asset, Bundle} from '@parcel/types';
import {Bundler} from '@parcel/plugin';

const ISOLATED_ENVS = new Set(['web-worker', 'service-worker']);
const OPTIONS = {
  minBundleSize: 30000,
  maxParallelRequests: 5
};

export default new Bundler({
  async bundle(graph) {
    // RULES
    // 1. If dep.isAsync or dep.isEntry, start a new bundle.
    // 2. If an asset has been seen before in a different bundle:
    //    a. If the asset is already in a parent bundle in the same entry point, exclude from the current bundle.
    //    b. If the asset is only in separate isolated entry points (e.g. workers, different HTML pages), duplicate it.
    //    c. If the sub-graph from this asset is >= 30kb, and the number of parallel requests at the current entry point is < 5, create a new bundle containing the sub-graph.
    //    d. Else, hoist the asset to the nearest common ancestor.

    // graph.walkAssets((asset, currentBundle) => {
    //   let deps = graph.getIncomingDeps(asset);
    //   let isIsolated = ISOLATED_ENVS.has(asset.env);

    //   // if (bundleAssetMap.has(asset)) {
    //   //   let commonBundle = findCommonBundle()
    //   // }

    //   let isAsync = deps.some(dep => dep.isAsync || dep.isEntry);
    //   let isSync = deps.some(dep => !dep.isSync && !dep.isEntry);
    //   if (isAsync || currentBundle.type !== asset.type) {
    //     // create new bundle
    //     let subGraph = graph.getSubGraph(asset);
    //   }

    //   if (isSync) {

    //   }
    // });
    let bundles = [];
    // function createBundle(type) {
    //   let bundle = {
    //     type: type,
    //     filePath: 'bundle.' + bundles.length + '.js',
    //     assets: []
    //   };

    //   bundles.push(bundle);
    //   return bundle;
    // }

    let bundleAssetMap = new Map();
    let bundleTree = null;

    graph.dfs((node, currentBundle) => {
      // if (node.type === 'asset') {
      //   // console.log(node.value.filePath, context && context.filePath)
      //   // return node.value;
      //   let asset: Asset = node.value;

      //   let deps = graph.getIncomingDependencies(asset);
      //   // console.log(asset.filePath, deps);

      //   let isAsync = deps.some(dep => dep.isAsync || dep.isEntry);
      //   if (isAsync) {
      //     // currentBundle = createBundle(asset.type);
      //     let bundle = graph.getSubGraph(node);
      //     currentBundle && currentBundle.removeNode(node);
      //     currentBundle = bundle;
      //     bundles.push(currentBundle);

      //     for (let node of currentBundle.nodes.values()) {
      //       if (node.type === 'asset') {
      //         if (!bundleAssetMap.has(node.value)) {
      //           bundleAssetMap.set(node.value, new Set);
      //         }

      //         bundleAssetMap.get(node.value).add(currentBundle);
      //       }
      //     }
      //   }

      //   // currentBundle.assets.push(asset);
      //   return currentBundle;
      // }

      if (node.type === 'dependency') {
        let dep = node.value;
        if (dep.isAsync || dep.isEntry) {
          let bundle = graph.getSubGraph(node);
          if (currentBundle) {
            // currentBundle.removeEdges(node);

            for (let req of graph.getNodesConnectedFrom(node)) {
              let bundleNode = {
                id: 'bundle:' + req.id,
                type: 'bundle',
                value: bundle
              };

              let b = currentBundle;
              while (b) {
                // b.addNode(bundleNode);
                // for (let node of b.getNodesConnectedTo(req)) {
                //   b.addEdge({from: node.id, to: bundleNode.id});
                // }

                // b.removeNode(req);
                b.bundle.replaceNodesConnectedTo(node, [bundleNode]);
                b = b.parent;
                // b.replaceNode()
              }
            }
          }

          let newBundleNode = {
            bundle,
            parent: currentBundle,
            children: []
          };

          if (!bundleTree) {
            bundleTree = newBundleNode;
          } else {
            currentBundle.children.push(newBundleNode);
          }

          currentBundle = bundleTree;
          bundles.push(bundle);
        }
      }

      return currentBundle;
    });

    let queue = [bundleTree];
    while (queue.length > 0) {
      let currentBundle = queue.shift();

      if (currentBundle.parent) {
        let dep = currentBundle.bundle.getRootNode().value;
        let isIsolated = dep.isEntry || ISOLATED_ENVS.has(dep.env.context);
        if (!isIsolated) {
          for (let node of currentBundle.bundle.nodes.values()) {
            // if (node.type === 'transformer_request') { console.log(currentBundle, node)}
            if (
              node.type === 'transformer_request' &&
              hasNode(currentBundle.parent, node)
            ) {
              console.log('dup', node);
              currentBundle.removeNode(node);
            }
          }
        }
      }

      queue.push(...currentBundle.children);
    }

    function hasNode(treeNode, node) {
      while (treeNode) {
        if (treeNode.bundle.hasNode(node)) {
          return true;
        }

        treeNode = treeNode.parent;
      }

      return false;
    }

    // console.log(bundleTree)

    // for (let bundle of bundles) {
    //   for (let node of bundle.nodes.values()) {
    //     if (node.type === 'asset') {
    //       if (!bundleAssetMap.has(node)) {
    //         bundleAssetMap.set(node, new Set);
    //       }

    //       bundleAssetMap.get(node).add(bundle);
    //     }
    //   }
    // }

    // for (let [asset, bundles] of bundleAssetMap) {
    //   if (bundles.size > 1) {
    //     console.log(asset.value.filePath)
    //   }
    // }

    for (let bundle of bundles) {
      // console.log(bundle.nodes)
      bundle.dumpGraphViz();
    }

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
