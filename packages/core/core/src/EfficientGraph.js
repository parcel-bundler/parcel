// @flow
import {fromNodeId, toNodeId} from './types';
import type {NodeId} from './types';

/**
 * Each node is represented with 2 4-byte chunks:
 * The first 4 bytes are the hash of the node's first incoming edge.
 * The second 4 bytes are the hash of the node's first outgoing edge.
 *
 * struct Node {
 *   int firstIn;
 *   int firstOut;
 * }
 *
 * ┌─────────────────────────┐
 * │        NODE_SIZE        │
 * ├────────────┬────────────┤
 * │  FIRST_IN  │ FIRST_OUT  │
 * └────────────┴────────────┘
 */
export const NODE_SIZE = 2;
/**
 * Each edge is represented with 5 4-byte chunks:
 * The first 4 bytes are the edge type.
 * The second 4 bytes are the id of the 'from' node.
 * The third 4 bytes are the id of the 'to' node.
 * The fourth 4 bytes are the hash of the 'to' node's incoming edge.
 * The fifth 4 bytes are the hash of the 'from' node's outgoing edge.
 *
 * struct Edge {
 *   int type;
 *   int from;
 *   int to;
 *   int nextIn;
 *   int nextOut
 * }
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                           EDGE_SIZE                            │
 * ├────────────┬────────────┬────────────┬────────────┬────────────┤
 * │    TYPE    │    FROM    │     TO     │  NEXT_IN   │  NEXT_OUT  │
 * └────────────┴────────────┴────────────┴────────────┴────────────┘
 */
export const EDGE_SIZE = 5;

/** The offset to `EDGE_SIZE` at which the edge type is stored. */
const TYPE = 0;
/** The offset to `EDGE_SIZE` at which the 'from' node id is stored. */
const FROM = 1;
/** The offset to `EDGE_SIZE` at which the 'to' node id is stored. */
const TO = 2;
/** The offset to `EDGE_SIZE` at which the hash of the 'to' node's incoming edge is stored. */
const NEXT_IN = 3;
/** The offset to `EDGE_SIZE` at which the hash of the 'from' node's incoming edge is stored. */
const NEXT_OUT = 4;

/** The offset to `NODE_SIZE` at which the hash of the first incoming edge is stored. */
const FIRST_IN = 0;
/** The offset to `NODE_SIZE` at which the hash of the first outgoing edge is stored. */
const FIRST_OUT = 1;

type EfficientGraphOpts = {|
  nodes: Uint32Array,
  edges: Uint32Array,
  numNodes: number,
  numEdges: number,
|};

export default class EfficientGraph {
  /** An array of nodes, which each node occupying `NODE_SIZE` adjacent indices. */
  nodes: Uint32Array;
  /** An array of edges, which each edge occupying `EDGE_SIZE` adjacent indices. */
  edges: Uint32Array;
  /** The count of the number of nodes in the graph. */
  numNodes: number;
  /** The count of the number of edges in the graph. */
  numEdges: number;

  constructor(nodeCapacity: number = 128, edgeCapacity: number = 256) {
    // Allocate two TypedArrays, one for nodes, and one for edges.
    // These are created with reasonable initial sizes,
    // but will be resized as necessary.
    this.nodes = new Uint32Array(nodeCapacity * NODE_SIZE);
    this.edges = new Uint32Array(edgeCapacity * EDGE_SIZE);
    this.numNodes = 0;
    this.numEdges = 0;
  }

  /**
   * Create a new `EfficientGraph` from the given options.
   *
   * The options should match the format returned by the `serialize` method.
   */
  static deserialize(opts: EfficientGraphOpts): EfficientGraph {
    let res = Object.create(EfficientGraph.prototype);
    res.nodes = opts.nodes;
    res.edges = opts.edges;
    res.numNodes = opts.numNodes;
    res.numEdges = opts.numEdges;
    return res;
  }

  /**
   * Returns a JSON-serializable object of the nodes and edges in the graph.
   */
  serialize(): EfficientGraphOpts {
    return {
      nodes: this.nodes,
      edges: this.edges,
      numNodes: this.numNodes,
      numEdges: this.numEdges,
    };
  }

  /**
   * Resize the internal nodes array.
   *
   * This is used in `addNode` when the `numNodes` meets or exceeds
   * the allocated size of the `nodes` array.
   */
  resizeNodes(size: number) {
    let nodes = this.nodes;
    // Allocate the required space for a `nodes` array of the given `size`.
    this.nodes = new Uint32Array(size * NODE_SIZE);
    // Copy the existing nodes into the new array.
    this.nodes.set(nodes);
  }

  /**
   * Resize the internal edges array.
   *
   * This is used in `addEdge` when the `numEdges` meets or exceeds
   * the allocated size of the `edges` array.
   */
  resizeEdges(size: number) {
    let edges = this.edges;
    // Allocate the required space for an `edges` array of the given `size`.
    this.edges = new Uint32Array(size * EDGE_SIZE);

    // Copy the existing edges into the new array.
    // TODO: Understand why this is more complex than `resizeNode`
    for (let i = 0; i < this.nodes.length; i += NODE_SIZE) {
      let lastOut;
      for (
        let hash = this.nodes[i + FIRST_OUT];
        hash;
        hash = edges[hash - 1 + NEXT_OUT]
      ) {
        let to = edges[hash - 1 + TO];
        let newHash = this.index(toNodeId(i), toNodeId(to));
        if (newHash === -1) {
          continue;
        }

        this.edges[newHash + TYPE] = edges[hash - 1 + TYPE];
        this.edges[newHash + FROM] = i;
        this.edges[newHash + TO] = to;
        if (lastOut != null) {
          this.edges[lastOut + NEXT_OUT] = 1 + newHash;
        } else {
          this.nodes[i + FIRST_OUT] = 1 + newHash;
        }

        lastOut = newHash;
      }

      let lastIn;
      for (
        let hash = this.nodes[i + FIRST_IN];
        hash;
        hash = edges[hash - 1 + NEXT_IN]
      ) {
        let from = edges[hash - 1 + FROM];
        let newHash = this.hash(toNodeId(from), toNodeId(i));
        while (this.edges[newHash + TYPE]) {
          if (
            this.edges[newHash + FROM] === from &&
            this.edges[newHash + TO] === i
          ) {
            break;
          } else {
            newHash = (newHash + EDGE_SIZE) % this.edges.length;
          }
        }

        this.edges[newHash + TYPE] = edges[hash - 1 + TYPE];
        this.edges[newHash + FROM] = from;
        this.edges[newHash + TO] = i;
        if (lastIn != null) {
          this.edges[lastIn + NEXT_IN] = 1 + newHash;
        } else {
          this.nodes[i + FIRST_IN] = 1 + newHash;
        }

        lastIn = newHash;
      }
    }
  }

  /**
   * Adds a node to the graph.
   *
   * Returns the id of the added node.
   */
  addNode(): NodeId {
    let id = this.numNodes;
    this.numNodes++;
    // If we're in danger of overflowing the `nodes` array, resize it.
    if (this.numNodes >= this.nodes.length / NODE_SIZE) {
      // The size of `nodes` doubles every time we reach the current capacity.
      // This means in the worst case, we will have `O(n - 1)` _extra_
      // space allocated where `n` is a number nodes that is 1 more
      // than the previous capacity.
      this.resizeNodes((this.nodes.length / NODE_SIZE) * 2);
    }
    return id;
  }

  /**
   * Adds an edge to the graph.
   *
   * Returns a `true` if the edge was added,
   * or `false` if the edge already exists.
   */
  addEdge(from: NodeId, to: NodeId, type: number = 1): boolean {
    // The percentage of utilization of the total capacity of `edges`.
    let load = this.numEdges / (this.edges.length / EDGE_SIZE);
    // If we're in danger of overflowing the `edges` array, resize it.
    if (load > 0.7) {
      // The size of `edges` doubles every time we reach the current capacity.
      // This means in the worst case, we will have `O(n - 1)` _extra_
      // space allocated where `n` is a number edges that is 1 more
      // than the previous capacity.
      this.resizeEdges((this.edges.length / EDGE_SIZE) * 2);
    }

    // We use the hash of the edge as the index for the edge.
    let hash = this.index(from, to);
    if (hash === -1) {
      // The edge is already in the graph; do nothing.
      return false;
    }

    this.numEdges++;

    // Each edge takes up `EDGE_SIZE` space in the `edges` array.
    // `[type, from, to, nextIncoming, nextOutgoing]`
    this.edges[hash + TYPE] = type;
    this.edges[hash + FROM] = fromNodeId(from);
    this.edges[hash + TO] = fromNodeId(to);
    this.edges[hash + NEXT_IN] = this.nodes[fromNodeId(to) + FIRST_IN];
    this.edges[hash + NEXT_OUT] = this.nodes[fromNodeId(from) + FIRST_OUT];
    // We store the hash of this edge as the `to` node's incoming edge
    // and as the `from` node's outgoing edge.
    // TODO: understand why `1` is added to the hash.
    this.nodes[fromNodeId(to) + FIRST_IN] = 1 + hash;
    this.nodes[fromNodeId(from) + FIRST_OUT] = 1 + hash;
    return true;
  }

  /**
   * Get the index at which to add an edge connecting the `from` and `to` nodes.
   *
   * If an edge connecting `from` and `to` already exists, returns `-1`,
   * otherwise, returns the index at which the edge should be added.
   *
   */
  index(from: NodeId, to: NodeId): number {
    // The index is most often simply the hash of edge.
    let hash = this.hash(from, to);

    // we scan the `edges` array for the next empty slot after the `hash` offset.
    // We do this instead of simply using the `hash` as the index because
    // it is possible for multiple edges to have the same hash.
    while (this.edges[hash + TYPE]) {
      if (this.edges[hash + FROM] === from && this.edges[hash + TO] === to) {
        // If this edge is already in the graph, bail out.
        return -1;
      } else {
        // There is already an edge at `hash`,
        // so scan forward for the next open slot to use as the the `hash`.
        // Note that each 'slot' is of size `EDGE_SIZE`.
        // Also note that we handle overflow of `edges` by wrapping
        // back to the beginning of the `edges` array.
        hash = (hash + EDGE_SIZE) % this.edges.length;
      }
    }

    return hash;
  }

  /**
   * Check if the graph has an edge connecting the `from` and `to` nodes.
   */
  hasEdge(from: NodeId, to: NodeId): boolean {
    return this.index(from, to) === -1;
  }

  /**
   * Get the list of nodes connected from
   */
  *getNodesConnectedFrom(from: NodeId): Iterable<NodeId> {
    for (
      let i = this.nodes[fromNodeId(from) + FIRST_OUT];
      i;
      i = this.edges[i - 1 + NEXT_OUT]
    ) {
      yield toNodeId(this.edges[i - 1 + TO]);
    }
  }

  /**
   * Get the list of nodes whose edges from to
   */
  *getNodesConnectedTo(to: NodeId): Iterable<NodeId> {
    for (
      let i = this.nodes[fromNodeId(to) + FIRST_IN];
      i;
      i = this.edges[i - 1 + NEXT_IN]
    ) {
      yield toNodeId(this.edges[i - 1 + FROM]);
    }
  }

  /**
   * Create a hash of the edge connecting the `from` and `to` nodes.
   *
   * This hash is used to index the edge in the `edges` array.
   */
  hash(from: NodeId, to: NodeId): number {
    // TODO: understand this hash function
    return Math.abs(
      ((fromNodeId(from) + 111111) * (fromNodeId(to) - 333333) * EDGE_SIZE) %
        this.edges.length,
    );
  }

  // TODO: getAllEdges(): Array<Edge<TEdgeType | NullEdgeType>> {
  // TODO: addNode(node: TNode): NodeId {
  // TODO: hasNode(id: NodeId): boolean {
  // TODO: getNode(id: NodeId): ?TNode {
  // TODO: addEdge(from: NodeId, to: NodeId, type: TEdgeType | NullEdgeType = 0): void {
  // TODO: hasEdge(from: NodeId, to: NodeId, type?: TEdgeType | NullEdgeType = 0): boolean {
  // TODO: removeNode(nodeId: NodeId) {
  // TODO: removeEdges(nodeId: NodeId, type: TEdgeType | NullEdgeType = 0) {
  // TODO: removeEdge(from: NodeId, to: NodeId, type: TEdgeType | NullEdgeType = 0, removeOrphans: boolean = true) {
  // TODO: _isOrphanedNode(nodeId: NodeId): boolean {
  // TODO: updateNode(nodeId: NodeId, node: TNode): void {
  // TODO: replaceNode(fromNodeId: NodeId, toNodeId: NodeId, type: TEdgeType | NullEdgeType = 0): void {
  // TODO: replaceNodeIdsConnectedTo(fromNodeId: NodeId, toNodeIds: $ReadOnlyArray<NodeId>, replaceFilter?: null | ((NodeId) => boolean), type?: TEdgeType | NullEdgeType = 0,): void {
  // TODO: traverse<TContext>(visit: GraphVisitor<NodeId, TContext>, startNodeId: ?NodeId, type: TEdgeType | NullEdgeType | Array<TEdgeType | NullEdgeType> = 0): ?TContext {
  // TODO: filteredTraverse<TValue, TContext>(filter: (NodeId, TraversalActions) => ?TValue, visit: GraphVisitor<TValue, TContext>, startNodeId: ?NodeId, type?: TEdgeType | Array<TEdgeType | NullEdgeType>): ?TContext {
  // TODO: traverseAncestors<TContext>(startNodeId: ?NodeId, visit: GraphVisitor<NodeId, TContext>, type: TEdgeType | NullEdgeType | Array<TEdgeType | NullEdgeType> = 0): ?TContext {
  // TODO: dfs<TContext>({visit, startNodeId, getChildren}: {| visit: GraphVisitor<NodeId, TContext>, getChildren(nodeId: NodeId): Array<NodeId>, startNodeId?: ?NodeId, |}): ?TContext {
  // TODO: bfs(visit: (nodeId: NodeId) => ?boolean): ?NodeId {
  // TODO: findAncestor(nodeId: NodeId, fn: (nodeId: NodeId) => boolean): ?NodeId {
  // TODO: findAncestors(nodeId: NodeId, fn: (nodeId: NodeId) => boolean): Array<NodeId> {
  // TODO: findDescendant(nodeId: NodeId, fn: (nodeId: NodeId) => boolean): ?NodeId {
  // TODO: findDescendants(nodeId: NodeId, fn: (nodeId: NodeId) => boolean): Array<NodeId> {
  // TODO: _assertHasNodeId(nodeId: NodeId) {
}
