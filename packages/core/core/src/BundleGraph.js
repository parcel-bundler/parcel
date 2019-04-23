// @flow strict-local

import type {Asset, GraphTraversalCallback} from '@parcel/types';
import type {Bundle, BundleGraphNode} from './types';

import Graph from './Graph';

export default class BundleGraph extends Graph<BundleGraphNode> {
  constructor() {
    super();
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
    return this.traverse((node, ...args) => {
      if (node.type === 'bundle') {
        return visit(node.value, ...args);
      }
    });
  }
}
