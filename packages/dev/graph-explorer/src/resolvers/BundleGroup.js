// @flow strict-local

import type {
  BundleGroupNode,
  NodeInput,
  NodeListInput,
  QueryContext,
} from '../types';

import invariant from 'assert';
import {Node, getBundleGraphNode, registerNodeType} from './Node';

export const typeDefs: string = `#graphql
  type BundleGroup implements Node {
    id: ID!
    contentKey: ID!
    type: String!
    nodesConnectedTo: [Node!]!
    nodesConnectedFrom: [Node!]!

    entryAsset: Asset!
    target: Target

    bundles: [Bundle!]!
  }

  type Query {
    bundleGroup(id: ID!): BundleGroup!
    allBundleGroups(args: NodeListInput): [BundleGroup!]!
  }
`;

export const resolvers = {
  BundleGroup: {
    __isTypeOf: (node: Node): boolean => node.type() === 'bundle_group',
  },
  Query: {
    bundleGroup: (
      _: mixed,
      args: NodeInput,
      context: QueryContext,
    ): BundleGroup => {
      let node = getBundleGraphNode(args, context);
      invariant(
        node,
        `No bundle group with id or content key ${String(args.id)}`,
      );
      invariant(
        node.type === 'bundle_group',
        `Expected a bundle_group but found ${node.type}`,
      );
      return new BundleGroup(node);
    },

    allBundleGroups: (
      _: mixed,
      __: NodeListInput,
      context: QueryContext,
    ): BundleGroup[] => {
      let bundleGroups = [];
      for (let node of context.bundleGraph.nodes.values()) {
        if (node.type === 'bundle_group') {
          bundleGroups.push(new BundleGroup(node));
        }
      }
      return bundleGroups;
    },
  },
};

export class BundleGroup extends Node {
  #node: BundleGroupNode;

  constructor(node: BundleGroupNode) {
    super(node);
    this.#node = node;
  }
}

registerNodeType('bundle_group', BundleGroup);
