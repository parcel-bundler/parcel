// @flow strict-local

import type {
  BundleNode,
  NodeInput,
  NodeListInput,
  QueryContext,
} from '../types';

import invariant from 'assert';
import {
  Node,
  getBundleGraphNode,
  getContentGraphForNode,
  registerNodeType,
} from './Node';
import {Asset} from './Asset';
import {BundleBehaviorNames} from '../types';

export const typeDefs: string = `#graphql
  enum BundleBehavior {
    inline
    isolated
  }

  type Bundle implements Node {
    id: ID!
    contentKey: ID!
    type: String!
    nodesConnectedTo: [Node!]!
    nodesConnectedFrom: [Node!]!

    # bundleType: String!
    # env: Environment!
    # target: Target!

    publicId: ID
    hashReference: ID!
    needsStableName: Boolean!
    isSplittable: Boolean!
    isPlaceholder: Boolean!
    bundleBehavior: BundleBehavior
    displayName: String!
    name: String!

    mainEntry: Asset!
    entryAssets: [Asset!]!
    assets: [Asset!]!

    # usedSymbols: [Symbol!]
  }

  type Query {
    bundle(id: ID!): Bundle!
    allBundles(args: NodeListInput): [Bundle!]!
  }
`;

export const resolvers = {
  Bundle: {
    __isTypeOf: (node: Node): boolean => node.type() === 'bundle',
  },
  Query: {
    bundle: (_: mixed, args: NodeInput, context: QueryContext): Bundle => {
      let node = getBundleGraphNode(args, context);
      invariant(node, `No bundle with id or content key ${String(args.id)}`);
      invariant(
        node.type === 'bundle',
        `Expected a bundle but found ${node.type}`,
      );
      return new Bundle(node);
    },

    allBundles: (
      _: mixed,
      __: NodeListInput,
      context: QueryContext,
    ): Bundle[] => {
      let bundles = [];
      for (let node of context.bundleGraph.nodes.values()) {
        if (node.type === 'bundle') {
          bundles.push(new Bundle(node));
        }
      }
      return bundles;
    },
  },
};

export class Bundle extends Node {
  #node: BundleNode;

  constructor(node: BundleNode) {
    super(node);
    this.#node = node;
  }

  publicId(): ?string {
    return this.#node.value.publicId;
  }

  hashReference(): string {
    return this.#node.value.hashReference;
  }

  name(): ?string {
    return this.#node.value.name;
  }

  displayName(): ?string {
    return this.#node.value.displayName;
  }

  bundleBehavior(): ?string {
    if (this.#node.value.bundleBehavior == null) {
      return null;
    }
    return BundleBehaviorNames[this.#node.value.bundleBehavior];
  }

  needsStableName(): boolean {
    return Boolean(this.#node.value.needsStableName);
  }

  isSplittable(): boolean {
    return Boolean(this.#node.value.isSplittable);
  }

  isPlaceholder(): boolean {
    return Boolean(this.#node.value.isPlaceholder);
  }

  mainEntry(_: mixed, context: QueryContext): ?Asset {
    let id = this.#node.value.mainEntryId;
    let graph = getContentGraphForNode(this.#node, context);
    if (id != null) {
      let mainEntry = graph.getNodeByContentKey(id);
      if (mainEntry?.type === 'asset') {
        return new Asset(mainEntry);
      }
    }
  }

  entryAssets(_: mixed, context: QueryContext): Array<Asset> {
    let assets = [];
    let graph = getContentGraphForNode(this.#node, context);
    for (let id of this.#node.value.entryAssetIds) {
      let asset = graph.getNodeByContentKey(id);
      if (asset?.type === 'asset') {
        assets.push(new Asset(asset));
      }
    }
    return assets;
  }

  assets(_: mixed, context: QueryContext): Array<Asset> {
    let assets = [];
    context.bundleGraph.traverseBundle(this.#node.value, node => {
      if (node?.type === 'asset') {
        assets.push(new Asset(node));
      }
    });
    return assets;
  }
}

registerNodeType('bundle', Bundle);
