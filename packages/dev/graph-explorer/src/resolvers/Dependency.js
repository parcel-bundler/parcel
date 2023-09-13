// @flow strict-local

import type {
  DependencyNode,
  NodeInput,
  NodeListInput,
  QueryContext,
} from '../types';

import invariant from 'assert';
import {Node, getAssetGraphNode, registerNodeType} from './Node';

export const typeDefs: string = `#graphql
  enum DepenencyPriority {
    sync
    parallel
    lazy
  }

  enum SpecifierType {
    commonjs
    esm
    url
    custom
  }

  type Dependency implements Node {
    id: ID!
    contentKey: ID!
    type: String!
    nodesConnectedTo: [Node!]!
    nodesConnectedFrom: [Node!]!

    specifier: String!
    specifierType: SpecifierType!
    priority: DepenencyPriority!
    bundleBehavior: BundleBehavior
    needsStableName: Boolean!
    isOptional: Boolean!
    isEntry: Boolean!

    sourceAsset: Asset
    sourcePath: String
    sourceAssetType: String

    resolveFrom: String
    range: String
    pipeline: String

    loc: SourceLocation
    env: Environment!
    packageConditions: [String!]
    meta: JSON
    target: Target
  }

  type Query {
    dependency(id: ID!): Dependency!
    allDependencies(args: NodeListInput): [Dependency!]!
  }
`;

export const resolvers = {
  Dependency: {
    __isTypeOf: (node: Node): boolean => node.type() === 'dependency',
  },
  Query: {
    dependency: (
      _: mixed,
      args: NodeInput,
      context: QueryContext,
    ): Dependency => {
      let node = getAssetGraphNode(args, context);
      invariant(
        node,
        `No dependency with id or content key ${String(args.id)}`,
      );
      invariant(
        node.type === 'dependency',
        `Expected an dependency but found ${node.type}`,
      );
      return new Dependency(node);
    },

    allDependencies: (
      _: mixed,
      __: NodeListInput,
      context: QueryContext,
    ): Dependency[] => {
      let dependencies = [];
      for (let node of context.assetGraph.nodes.values()) {
        if (node.type === 'dependency') {
          dependencies.push(new Dependency(node));
        }
      }
      return dependencies;
    },
  },
};

export class Dependency extends Node {
  #node: DependencyNode;

  constructor(node: DependencyNode) {
    super(node);
    this.#node = node;
  }

  specifier(): string {
    return String(this.#node.value.specifier);
  }
}

registerNodeType('dependency', Dependency);
