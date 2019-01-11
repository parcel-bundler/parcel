// @flow
import type {
  Asset,
  Bundle,
  BundleGroup,
  GraphTraversalCallback
} from '@parcel/types';
import AssetGraph from './AssetGraph';

const getBundleGroupId = (bundleGroup: BundleGroup) =>
  'bundle_group:' + bundleGroup.entryAssetId;

export default class BundleGraph extends AssetGraph {
  constructor() {
    super();
    this.setRootNode({
      type: 'root',
      id: 'root',
      value: null
    });
  }

  addBundleGroup(parentBundle: ?Bundle, bundleGroup: BundleGroup) {
    let node = {
      id: getBundleGroupId(bundleGroup),
      type: 'bundle_group',
      value: bundleGroup
    };

    // Add a connection from the dependency to the new bundle group in all bundles
    this.traverse(bundle => {
      if (bundle.type === 'bundle') {
        let depNode = bundle.value.assetGraph.getNode(
          bundleGroup.dependency.id
        );
        if (depNode) {
          bundle.value.assetGraph.replaceNodesConnectedTo(depNode, [node]);
        }
      }
    });

    this.addNode(node);
    this.addEdge({
      from: !parentBundle ? 'root' : parentBundle.id,
      to: node.id
    });
  }

  addBundle(bundleGroup: BundleGroup, bundle: Bundle) {
    // Propagate target from bundle group to bundle
    if (bundleGroup.target && !bundle.target) {
      bundle.target = bundleGroup.target;
    }

    let bundleGroupId = getBundleGroupId(bundleGroup);
    let bundleNode = {
      id: bundle.id,
      type: 'bundle',
      value: bundle
    };

    this.addNode(bundleNode);
    this.addEdge({
      from: bundleGroupId,
      to: bundleNode.id
    });

    this.traverse(node => {
      // Replace dependencies in this bundle with bundle group references for
      // already created bundles in the bundle graph. This can happen when two
      // bundles point to the same dependency, which has an async import.
      if (node.type === 'bundle_group') {
        let depNode = bundle.assetGraph.getNode(node.value.dependency.id);
        if (depNode && !bundle.assetGraph.hasNode(node.id)) {
          bundle.assetGraph.merge(this.getSubGraph(node));
          bundle.assetGraph.replaceNodesConnectedTo(depNode, [node]);
          this.addEdge({from: bundle.id, to: node.id});
        }
      }

      // Add a connection from the bundle group to the bundle in all bundles
      if (
        node.type === 'bundle' &&
        node.value.assetGraph.hasNode(bundleGroupId)
      ) {
        node.value.assetGraph.addNode(bundleNode);
        node.value.assetGraph.addEdge({
          from: bundleGroupId,
          to: bundleNode.id
        });
      }
    });
  }

  getBundles(bundleGroup: BundleGroup): Array<Bundle> {
    let bundleGroupId = getBundleGroupId(bundleGroup);
    let node = this.getNode(bundleGroupId);
    if (!node) {
      return [];
    }

    return this.getNodesConnectedFrom(node).map(node => node.value);
  }

  getBundleGroups(bundle: Bundle): Array<BundleGroup> {
    let node = this.getNode(bundle.id);
    if (!node) {
      return [];
    }

    return this.getNodesConnectedTo(node).map(node => node.value);
  }

  isAssetInAncestorBundle(bundle: Bundle, asset: Asset): boolean {
    let bundleNode = this.getNode(bundle.id);
    if (!bundleNode) {
      return false;
    }

    let ret = null;
    this.traverseAncestors(bundleNode, (node, context, traversal) => {
      // Skip starting node
      if (node === bundleNode) {
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

  findBundlesWithAsset(asset: Asset): Array<Bundle> {
    return Array.from(this.nodes.values())
      .filter(
        node =>
          node.type === 'bundle' && node.value.assetGraph.hasNode(asset.id)
      )
      .map(node => node.value);
  }

  traverseBundles(visit: GraphTraversalCallback<Bundle>): any {
    return this.traverse((node, ...args) => {
      if (node.type === 'bundle') {
        return visit(node.value, ...args);
      }
    });
  }
}
