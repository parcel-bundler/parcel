// @flow strict-local

import type {GraphTraversalCallback} from '@parcel/types';
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
