// @flow strict-local

import type {
  AssetGraph,
  AssetGraphNode,
  BundleGraph,
  BundleGraphNode,
  RequestGraph,
  RequestGraphNode,
  QueryContext,
  ContentKey,
  NodeId,
  NodeInput,
} from '../types';

import {ALL_EDGE_TYPES, toNodeId} from '@parcel/graph';
import invariant from 'assert';

const nodeTypes: Map<string, typeof Node> = new Map();

export const typeDefs: string = /* GraphQL */ `
  interface Node {
    "The unique id of this node."
    id: ID!
    "The unique content key of this node."
    contentKey: ID!
    "All nodes connected to this node."
    nodesConnectedTo: [Node!]!
    "All nodes connected from this node."
    nodesConnectedFrom: [Node!]!
  }

  input NodeInput {
    id: ID
    contentKey: ID
  }

  input NodeListInput {
    ids: [ID!]
    contentKeys: [ID!]
  }

  type Query {
    node(args: NodeInput!): Node!
  }
`;

export const resolvers = {
  Query: {
    node(_: mixed, args: NodeInput, context: QueryContext): Node {
      let node =
        getBundleGraphNode(args, context) ?? getAssetGraphNode(args, context);
      invariant(node, `No node with id or content key ${String(args.id)}`);
      let NodeType = nodeTypes.get(node.type) ?? Node;
      return new NodeType(node);
    },
  },
};

export class Node {
  #node: AssetGraphNode | BundleGraphNode;

  constructor(node: AssetGraphNode | BundleGraphNode) {
    this.#node = node;
  }

  contentKey(): ContentKey {
    return this.#node.id;
  }

  id(_: mixed, context: QueryContext): NodeId {
    return getContentGraphForNode(this.#node, context).getNodeIdByContentKey(
      this.contentKey(),
    );
  }

  type(): string {
    return this.#node.type;
  }

  nodesConnectedTo(_: mixed, context: QueryContext): Array<Node> {
    let nodes = [];
    let graph = getContentGraphForNode(this.#node, context);
    for (let nodeId of graph.getNodeIdsConnectedTo(
      this.id(_, context),
      ALL_EDGE_TYPES,
    )) {
      let node = graph.getNode(nodeId);
      if (node != null) {
        let NodeType = nodeTypes.get(node.type) ?? Node;
        nodes.push(new NodeType(node));
      }
    }
    return nodes;
  }

  nodesConnectedFrom(_: mixed, context: QueryContext): Array<Node> {
    let nodes = [];
    let graph = getContentGraphForNode(this.#node, context);
    for (let nodeId of graph.getNodeIdsConnectedFrom(
      this.id(_, context),
      ALL_EDGE_TYPES,
    )) {
      let node = graph.getNode(nodeId);
      if (node != null) {
        let NodeType = nodeTypes.get(node.type) ?? Node;
        nodes.push(new NodeType(node));
      }
    }
    return nodes;
  }
}

export function registerNodeType(type: string, NodeType: typeof Node) {
  nodeTypes.set(type, NodeType);
}

declare function getContentGraphForNode(
  node: AssetGraphNode,
  context: QueryContext,
): AssetGraph;

// eslint-disable-next-line no-redeclare
declare function getContentGraphForNode(
  node: BundleGraphNode,
  context: QueryContext,
): $PropertyType<BundleGraph, '_graph'>;

// eslint-disable-next-line no-redeclare
declare function getContentGraphForNode(
  node: RequestGraphNode,
  context: QueryContext,
): RequestGraph;

// eslint-disable-next-line no-redeclare
export function getContentGraphForNode(
  node: AssetGraphNode | BundleGraphNode | RequestGraphNode,
  context: QueryContext,
) {
  switch (node.type) {
    case 'asset_group':
      return context.assetGraph;
    case 'asset':
    case 'bundle':
    case 'bundle_group':
    case 'dependency':
    case 'entry_file':
    case 'entry_specifier':
    case 'root':
      return context.bundleGraph._graph;
    case 'request':
    case 'file':
    case 'file_name':
    case 'glob':
    case 'env':
    case 'option':
      return context.requestTracker.graph;
    default:
      throw new Error(
        `Unhandled node type: ${(node.type: empty)}. This is a bug!`,
      );
  }
}

declare function resolveId(
  id: NodeId | ContentKey,
  graph: AssetGraph,
): ?AssetGraphNode;
// eslint-disable-next-line no-redeclare
declare function resolveId(
  id: NodeId | ContentKey,
  graph: $PropertyType<BundleGraph, '_graph'>,
): ?BundleGraphNode;
// eslint-disable-next-line no-redeclare
declare function resolveId(
  id: NodeId | ContentKey,
  graph: RequestGraph,
): ?RequestGraphNode;

// eslint-disable-next-line no-redeclare
function resolveId(id, graph) {
  let node;
  if (typeof id === 'string') {
    let nodeId = parseInt(id, 10);
    if (!isNaN(nodeId)) {
      node = graph.getNode(toNodeId(nodeId));
    }
    if (node == null) {
      node = graph.getNodeByContentKey(id);
    }
  } else {
    node = graph.getNode(id);
  }
  return node;
}

export function getAssetGraphNode(
  {id}: NodeInput,
  {assetGraph}: QueryContext,
): ?AssetGraphNode {
  return resolveId(id, assetGraph);
}

export function getBundleGraphNode(
  {id}: NodeInput,
  {bundleGraph}: QueryContext,
): ?BundleGraphNode {
  return resolveId(id, bundleGraph._graph);
}

export function getRequestGraphNode(
  {id}: NodeInput,
  {requestTracker}: QueryContext,
): ?RequestGraphNode {
  return resolveId(id, requestTracker.graph);
}
