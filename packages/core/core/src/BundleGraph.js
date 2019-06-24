// @flow strict-local

import type {GraphTraversalCallback} from '@parcel/types';
import type Asset from './Asset';
import type {Bundle, BundleGraphNode} from './types';

import Graph, {type GraphOpts} from './Graph';

export default class BundleGraph extends Graph<BundleGraphNode> {
  constructor(opts?: GraphOpts<BundleGraphNode>) {
    super(opts);
    this.setRootNode({
      type: 'root',
      id: 'root',
      value: null
    });
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

  traverseBundles<TContext>(
    visit: GraphTraversalCallback<Bundle, TContext>
  ): ?TContext {
    return this.filteredTraverse(
      node => (node.type === 'bundle' ? node.value : null),
      visit
    );
  }

  isAssetReferenced(asset: Asset) {
    let result = false;

    this.traverseBundles((bundle, context, traversal) => {
      let referenceNode = bundle.assetGraph.findNode(
        node => node.type === 'asset_reference' && node.value.id === asset.id
      );
      if (referenceNode) {
        result = true;
        traversal.stop();
      }
    });

    return result;
  }
}
