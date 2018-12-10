import AssetGraph from './AssetGraph';

export default class BundleGraph extends AssetGraph {
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
