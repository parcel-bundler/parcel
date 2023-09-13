// @flow strict-local

import type {RootNode, QueryContext} from '../types';
import type {ContentGraph} from '@parcel/graph';

import {Node, registerNodeType} from './Node';

export const typeDefs: string = `#graphql
  type Root implements Node {
    id: ID!
    contentKey: ID!
    type: String!
    nodesConnectedTo: [Node!]!
    nodesConnectedFrom: [Node!]!

    value: String
  }
`;

export const resolvers = {
  Root: {
    __isTypeOf: (node: Node): boolean => node.type() === 'root',
  },
};

export class Root extends Node {
  #node: RootNode;

  constructor(node: RootNode) {
    super(node);
    this.#node = node;
  }

  get value(): ?string {
    return String(this.#node.value);
  }
}

// $FlowFixMe[unclear-type]
function resolveRoot(graph: ContentGraph<any, any>): ?RootNode {
  if (graph.rootNodeId == null) return null;
  return graph.getNode(graph.rootNodeId);
}

export function getAssetGraphRoot({assetGraph}: QueryContext): ?RootNode {
  return resolveRoot(assetGraph);
}

export function getBundleGraphRoot({bundleGraph}: QueryContext): ?RootNode {
  return resolveRoot(bundleGraph._graph);
}

registerNodeType('root', Root);
