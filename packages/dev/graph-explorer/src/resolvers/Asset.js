// @flow strict-local
/* eslint-disable monorepo/no-internal-import */

import type {JSONObject} from '@parcel/types';
import type {AssetNode, NodeInput, NodeListInput, QueryContext} from '../types';

import invariant from 'assert';
import {
  Node,
  getAssetGraphNode,
  getBundleGraphNode,
  registerNodeType,
} from './Node';
import {Bundle} from './Bundle';
import {Dependency} from './Dependency';
import {BundleBehaviorNames} from '../types';

export const typeDefs: string = `#graphql
  type Asset implements Node {
    id: ID!
    contentKey: ID!
    type: String!
    nodesConnectedTo: [Node!]!
    nodesConnectedFrom: [Node!]!

    assetType: String!
    filePath: String!
    isSource: Boolean!
    bundleBehavior: BundleBehavior
    isBundleSplittable: Boolean!
    sideEffects: Boolean!

    uniqueKey: String
    pipeline: String

    size: Int!
    time: Int!
    query: String
    env: Environment!
    meta: JSONObject!

    dependencies: [Dependency!]!
    dependents: [Dependency!]!
    bundles: [Bundle!]!
  }

  type Query {
    asset(id: ID!): Asset!
    allAssets(args: NodeListInput): [Asset!]!
  }
`;

export const resolvers = {
  Asset: {
    __isTypeOf: (node: Node): boolean => node.type() === 'asset',
  },
  Query: {
    asset: (_: mixed, args: NodeInput, context: QueryContext): Asset => {
      let node = getAssetGraphNode(args, context);
      invariant(node, `No asset with id or content key ${String(args.id)}`);
      invariant(
        node.type === 'asset',
        `Expected an asset but found ${node.type}`,
      );
      return new Asset(node);
    },

    allAssets: (
      _: mixed,
      __: NodeListInput,
      context: QueryContext,
    ): Asset[] => {
      let assets = [];
      for (let node of context.assetGraph.nodes.values()) {
        if (node.type === 'asset') {
          assets.push(new Asset(node));
        }
      }
      return assets;
    },
  },
};

export class Asset extends Node {
  #node: AssetNode;

  constructor(node: AssetNode) {
    super(node);
    this.#node = node;
  }

  filePath(): string {
    return String(this.#node.value.filePath);
  }

  isSource(): boolean {
    return this.#node.value.isSource;
  }

  assetType(): string {
    return this.#node.value.type;
  }

  bundleBehavior(): ?string {
    if (this.#node.value.bundleBehavior == null) {
      return null;
    }
    return BundleBehaviorNames[this.#node.value.bundleBehavior];
  }

  isBundleSplittable(): boolean {
    return this.#node.value.isBundleSplittable;
  }

  sideEffects(): boolean {
    return this.#node.value.sideEffects;
  }

  uniqueKey(): ?string {
    return this.#node.value.uniqueKey;
  }

  pipeline(): ?string {
    return this.#node.value.pipeline;
  }

  query(): ?string {
    return this.#node.value.query;
  }

  // env(): EnvironmentType {
  //   return this.#node.value.env;
  // }

  meta(): JSONObject {
    return this.#node.value.meta;
  }

  size(): number {
    return this.#node.value.stats.size;
  }

  time(): number {
    return this.#node.value.stats.time;
  }

  dependencies(_: mixed, context: QueryContext): Dependency[] {
    let deps = [];
    for (let id of this.#node.value.dependencies.keys()) {
      let node = getAssetGraphNode({id}, context);
      if (node?.type === 'dependency') {
        deps.push(new Dependency(node));
      }
    }
    return deps;
  }

  dependents(_: mixed, context: QueryContext): Dependency[] {
    let deps = [];
    let graph = context.assetGraph;
    for (let {id} of graph.getIncomingDependencies(this.#node.value)) {
      let node = getAssetGraphNode({id}, context);
      if (node?.type === 'dependency') {
        deps.push(new Dependency(node));
      }
    }

    return deps;
  }

  bundles(_: mixed, context: QueryContext): Array<Bundle> {
    let bundles = [];
    let graph = context.bundleGraph;
    for (let bundle of graph.getBundlesWithAsset(this.#node.value)) {
      let node = getBundleGraphNode({id: bundle.id}, context);
      if (node?.type === 'bundle') {
        bundles.push(new Bundle(node));
      }
    }
    return bundles;
  }
}

registerNodeType('asset', Asset);
