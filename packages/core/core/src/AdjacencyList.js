// @flow
import {digraph} from 'graphviz';
import {spawn} from 'child_process';
import assert from 'assert';
import {DefaultMap} from '@parcel/utils';
import {fromNodeId, toNodeId} from './types';
import type {NullEdgeType, AllEdgeTypes} from './Graph';
import type {NodeId} from './types';

/**
 * Each node is represented with 2 4-byte chunks:
 * The first 4 bytes are the hash of the node's first incoming edge.
 * The second 4 bytes are the hash of the node's first outgoing edge.
 * The second 4 bytes are the hash of the node's last incoming edge.
 * The second 4 bytes are the hash of the node's last outgoing edge.
 *
 * struct Node {
 *   int firstIn;
 *   int firstOut;
 *   int lastIn;
 *   int lastOut;
 * }
 *
 * ┌─────────────────────────────────────────────────┐
 * │                    NODE_SIZE                    │
 * ├────────────┬───────────┬───────────┬────────────┤
 * │  FIRST_IN  │ FIRST_OUT │  LAST_IN  │  LAST_OUT  │
 * └────────────┴───────────┘───────────┴────────────┘
 */
export const NODE_SIZE = 4;
/**
 * Each edge is represented with 5 4-byte chunks:
 * The first 4 bytes are the edge type.
 * The second 4 bytes are the id of the 'from' node.
 * The third 4 bytes are the id of the 'to' node.
 * The fourth 4 bytes are the hash of the 'to' node's previous incoming edge.
 * The fifth 4 bytes are the hash of the 'from' node's previous incoming edge.
 * The sixth 4 bytes are the hash of the 'to' node's next incoming edge.
 * The seventh 4 bytes are the hash of the 'from' node's next outgoing edge.
 *
 * struct Edge {
 *   int type;
 *   int from;
 *   int to;
 *   int prevIn;
 *   int prevOut;
 *   int nextIn;
 *   int nextOut;
 * }
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │                                        EDGE_SIZE                                         │
 * ├────────────┬────────────┬────────────┬────────────┬────────────┬────────────┬────────────┤
 * │    TYPE    │    FROM    │     TO     │  PREV_IN   │  PREV_OUT  │  NEXT_IN   │  NEXT_OUT  │
 * └────────────┴────────────┴────────────┴────────────┴────────────┴────────────┴────────────┘
 */
export const EDGE_SIZE = 7;

/** The offset from an edge index at which the edge type is stored. */
const TYPE: 0 = 0;
/** The offset from an edge index at which the 'from' node id is stored. */
const FROM: 1 = 1;
/** The offset from an edge index at which the 'to' node id is stored. */
const TO: 2 = 2;
/** The offset from an edge index at which the hash of the 'to' node's previous incoming edge is stored. */
const PREV_IN: 3 = 3;
/** The offset from an edge index at which the hash of the 'from' node's previous incoming edge is stored. */
const PREV_OUT: 4 = 4;
/** The offset from an edge index at which the hash of the 'to' node's next incoming edge is stored. */
const NEXT_IN: 5 = 5;
/** The offset from an edge index at which the hash of the 'from' node's next incoming edge is stored. */
const NEXT_OUT: 6 = 6;

/** The offset from a node index at which the hash of the first incoming edge is stored. */
const FIRST_IN: 0 = 0;
/** The offset from a node index at which the hash of the first outgoing edge is stored. */
const FIRST_OUT: 1 = 1;
/** The offset from a node index at which the hash of the last incoming edge is stored. */
const LAST_IN: 2 = 2;
/** The offset from a node index at which the hash of the last outgoing edge is stored. */
const LAST_OUT: 3 = 3;

/**
 * A sentinel that indicates that an edge was deleted.
 *
 * Because our (open-addressed) table resolves hash collisions
 * by scanning forward for the next open slot when inserting,
 * and stops scanning at the next open slot when fetching,
 * we use this sentinel (instead of `0`) to maintain contiguity.
 */
const DELETED: 0xffffffff = 0xffffffff;

export function isDeleted<TEdgeType>(type: TEdgeType): boolean {
  return type === DELETED;
}

export const ALL_EDGE_TYPES: AllEdgeTypes = '@@all_edge_types';

// eslint-disable-next-line no-unused-vars
export type SerializedAdjacencyList<TEdgeType> = {|
  nodes: Uint32Array,
  edges: Uint32Array,
  numNodes: number,
  numEdges: number,
  edgeCapacity: number,
  nodeCapacity: number,
|};

opaque type EdgeHash = number;

/** Get the hash of the edge at the given index in the edges array. */
const indexToHash = (index: number): EdgeHash => index + 1;

/** Get the index in the edges array of the given edge. */
const hashToIndex = (hash: EdgeHash) => Math.max(0, hash - 1);

/** Get the id of the node at the given index in the nodes array. */
const nodeAt = (index: number): NodeId =>
  toNodeId((index - (index % NODE_SIZE)) / NODE_SIZE);

/** Get the index in the nodes array of the given node. */
const indexOfNode = (id: NodeId): number => fromNodeId(id) * NODE_SIZE;

export default class AdjacencyList<TEdgeType: number = 1> {
  /** The number of nodes that can fit in the nodes array. */
  nodeCapacity: number;
  /** The number of edges that can fit in the edges array. */
  edgeCapacity: number;
  /** An array of nodes, with each node occupying `NODE_SIZE` adjacent indices. */
  nodes: Uint32Array;
  /** An array of edges, with each edge occupying `EDGE_SIZE` adjacent indices. */
  edges: Uint32Array;
  /** The count of the number of nodes in the graph. */
  numNodes: number;
  /** The count of the number of edges in the graph. */
  numEdges: number;
  /** A map of node ids from => through types => to node ids. */
  fromTypeMap: DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>;
  /** A map of node ids to => through types => from node ids. */
  toTypeMap: DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>;

  constructor(nodeCapacity: number = 128, edgeCapacity: number = 256) {
    this.nodeCapacity = nodeCapacity;
    this.edgeCapacity = edgeCapacity;
    // Allocate two TypedArrays, one for nodes, and one for edges.
    // These are created with reasonable initial sizes,
    // but will be resized as necessary.
    this.nodes = new Uint32Array(nodeCapacity * NODE_SIZE);
    this.edges = new Uint32Array(edgeCapacity * EDGE_SIZE);
    this.numNodes = 0;
    this.numEdges = 0;

    this.fromTypeMap = new DefaultMap(() => new DefaultMap(() => new Set()));
    this.toTypeMap = new DefaultMap(() => new DefaultMap(() => new Set()));
  }

  /**
   * Create a new `AdjacencyList` from the given options.
   *
   * The options should match the format returned by the `serialize` method.
   */
  static deserialize(
    opts: SerializedAdjacencyList<TEdgeType>,
  ): AdjacencyList<TEdgeType> {
    let res = Object.create(AdjacencyList.prototype);
    res.nodes = opts.nodes;
    res.edges = opts.edges;
    res.numNodes = opts.numNodes;
    res.numEdges = opts.numEdges;
    res.nodeCapacity = opts.nodeCapacity;
    res.edgeCapacity = opts.edgeCapacity;
    return res;
  }

  /**
   * Returns a JSON-serializable object of the nodes and edges in the graph.
   */
  serialize(): SerializedAdjacencyList<TEdgeType> {
    return {
      nodes: this.nodes,
      edges: this.edges,
      numNodes: this.numNodes,
      numEdges: this.numEdges,
      edgeCapacity: this.edgeCapacity,
      nodeCapacity: this.nodeCapacity,
    };
  }

  get stats(): {|
    /** The number of nodes in the graph. */
    nodes: number,
    /** The maximum number of nodes the graph can contain. */
    nodeCapacity: number,
    /** The current load on the nodes array. */
    nodeLoad: number,
    /** The number of edges in the graph. */
    edges: number,
    /** The maximum number of edges the graph can contain. */
    edgeCapacity: number,
    /** The current load on the edges array. */
    edgeLoad: number,
    /** The total number of edge hash collisions. */
    collisions: number,
    /** The number of collisions for the most common hash. */
    maxCollisions: number,
    /** The likelihood of uniform distribution. ~1.0 indicates certainty. */
    uniformity: number,
  |} {
    let {numNodes, nodeCapacity, numEdges, edgeCapacity} = this;
    let buckets = new Map();
    for (let {from, to, type} of this.getAllEdges()) {
      let hash = this.hash(from, to, type);
      let bucket = buckets.get(hash) || new Set();
      let key = `${String(from)}, ${String(to)}, ${String(type)}`;
      assert(!bucket.has(key), `Duplicate node detected: ${key}`);
      bucket.add(key);
      buckets.set(hash, bucket);
    }

    let maxCollisions = 0;
    let collisions = 0;
    let distribution = 0;

    for (let bucket of buckets.values()) {
      maxCollisions = Math.max(maxCollisions, bucket.size - 1);
      collisions += bucket.size - 1;
      distribution += (bucket.size * (bucket.size + 1)) / 2;
    }

    let uniformity =
      distribution /
      ((numEdges / (2 * edgeCapacity)) * (numEdges + 2 * edgeCapacity - 1));

    return {
      nodes: numNodes,
      edges: numEdges,
      nodeCapacity,
      nodeLoad: numNodes / nodeCapacity,
      edgeCapacity,
      edgeLoad: numEdges / edgeCapacity,
      collisions,
      maxCollisions,
      uniformity,
    };
  }
  /** Iterate over node ids in the `AdjacencyList`. */
  *iterateNodes(max: number = this.numNodes): Iterator<NodeId> {
    let count = 0;
    for (let i = 0; i < this.nodes.length; i += NODE_SIZE) {
      if (count++ >= max) break;
      yield nodeAt(i);
    }
  }

  /** Iterate over outgoing edge hashes from the given `nodeId` the `AdjacencyList`. */
  *iterateOutgoingEdges(nodeId: NodeId): Iterator<EdgeHash> {
    for (
      let hash = this.nodes[indexOfNode(nodeId) + FIRST_OUT];
      hash;
      hash = this.edges[hashToIndex(hash) + NEXT_OUT]
    ) {
      yield hash;
    }
  }

  /** Iterate over incoming edge hashes to the given `nodeId` the `AdjacencyList`. */
  *iterateIncomingEdges(nodeId: NodeId): Iterator<EdgeHash> {
    for (
      let hash = this.nodes[indexOfNode(nodeId) + FIRST_IN];
      hash;
      hash = this.edges[hashToIndex(hash) + NEXT_IN]
    ) {
      yield hash;
    }
  }

  /** Check that the edge exists in the `AdjacencyList`. */
  edgeExists(edge: EdgeHash): boolean {
    let type = (this.edges[hashToIndex(edge) + TYPE]: any);
    return Boolean(type) && !isDeleted(type);
  }

  /** Get the type of the given edge. */
  getEdgeType(edge: EdgeHash): TEdgeType {
    assert(this.edgeExists(edge));
    return (this.edges[hashToIndex(edge) + TYPE]: any);
  }

  /** Get the node id the given edge originates from */
  getFromNode(edge: EdgeHash): NodeId {
    assert(this.edgeExists(edge));
    return toNodeId(this.edges[hashToIndex(edge) + FROM]);
  }

  /** Get the node id the given edge terminates to. */
  getToNode(edge: EdgeHash): NodeId {
    assert(this.edgeExists(edge));
    return toNodeId(this.edges[hashToIndex(edge) + TO]);
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
    this.nodeCapacity = size;
  }

  /**
   * Resize the internal edges array.
   *
   * This is used in `addEdge` when the `numEdges` meets or exceeds
   * the allocated size of the `edges` array.
   */
  resizeEdges(size: number) {
    // Allocate the required space for new `nodes` and `edges` arrays.
    let copy = new AdjacencyList(this.nodeCapacity, size);
    copy.numNodes = this.numNodes;

    // For each node in the graph, copy the existing edges into the new array.
    for (let from of this.iterateNodes()) {
      for (let edge of this.iterateOutgoingEdges(from)) {
        copy.addEdge(from, this.getToNode(edge), this.getEdgeType(edge));
      }
    }

    // Finally, copy the new data arrays over to this graph.
    this.nodes = copy.nodes;
    this.edges = copy.edges;
    this.edgeCapacity = size;
    this.fromTypeMap = copy.fromTypeMap;
    this.toTypeMap = copy.toTypeMap;
  }

  /** Create mappings from => type => to and vice versa. */
  buildTypeMaps() {
    this.fromTypeMap = new DefaultMap(() => new DefaultMap(() => new Set()));
    this.toTypeMap = new DefaultMap(() => new DefaultMap(() => new Set()));
    for (let node of this.iterateNodes()) {
      for (let edge of this.iterateOutgoingEdges(node)) {
        this.fromTypeMap
          .get(node)
          .get(this.getEdgeType(edge))
          .add(this.getToNode(edge));
      }
      for (let edge of this.iterateIncomingEdges(node)) {
        this.toTypeMap
          .get(node)
          .get(this.getEdgeType(edge))
          .add(this.getFromNode(edge));
      }
    }
  }

  /** Get or set the first outgoing edge from the given node. */
  firstOutgoingEdge(node: NodeId, edge: ?(EdgeHash | null)): EdgeHash | null {
    if (edge !== undefined) {
      this.nodes[indexOfNode(node) + FIRST_OUT] = edge ?? 0;
    }
    let hash = this.nodes[indexOfNode(node) + FIRST_OUT];
    return hash ? hash : null;
  }

  /** Get or set the last outgoing edge from the given node. */
  lastOutgoingEdge(node: NodeId, edge: ?(EdgeHash | null)): EdgeHash | null {
    if (edge !== undefined) {
      this.nodes[indexOfNode(node) + LAST_OUT] = edge ?? 0;
    }
    let hash = this.nodes[indexOfNode(node) + LAST_OUT];
    return hash ? hash : null;
  }

  /** Get or set the first incoming edge to the given node. */
  firstIncomingEdge(node: NodeId, edge: ?(EdgeHash | null)): EdgeHash | null {
    if (edge !== undefined) {
      this.nodes[indexOfNode(node) + FIRST_IN] = edge ?? 0;
    }
    let hash = this.nodes[indexOfNode(node) + FIRST_IN];
    return hash ? hash : null;
  }

  /** Get or set the last incoming edge to the given node. */
  lastIncomingEdge(node: NodeId, edge: ?(EdgeHash | null)): EdgeHash | null {
    if (edge !== undefined) {
      this.nodes[indexOfNode(node) + LAST_IN] = edge ?? 0;
    }
    let hash = this.nodes[indexOfNode(node) + LAST_IN];
    return hash ? hash : null;
  }

  /** Get or set the next outgoing edge from the given edge's originating node. */
  nextOutgoingEdge(edge: EdgeHash, next: ?(EdgeHash | null)): EdgeHash | null {
    if (next !== undefined) {
      this.edges[hashToIndex(edge) + NEXT_OUT] = next ?? 0;
    }
    let hash = this.edges[hashToIndex(edge) + NEXT_OUT];
    return hash ? hash : null;
  }

  /** Get or set the previous outgoing edge from the given edge's originating node. */
  previousOutgoingEdge(
    edge: EdgeHash,
    previous: ?(EdgeHash | null),
  ): EdgeHash | null {
    if (previous !== undefined) {
      this.edges[hashToIndex(edge) + PREV_OUT] = previous ?? 0;
    }
    let hash = this.edges[hashToIndex(edge) + PREV_OUT];
    return hash ? hash : null;
  }

  /** Get or set the next incoming edge to the given edge's terminating node. */
  nextIncomingEdge(edge: EdgeHash, next: ?(EdgeHash | null)): EdgeHash | null {
    if (next !== undefined) {
      this.edges[hashToIndex(edge) + NEXT_IN] = next ?? 0;
    }
    let hash = this.edges[hashToIndex(edge) + NEXT_IN];
    return hash ? hash : null;
  }

  /** Get or set the previous incoming edge to the given edge's terminating node. */
  previousIncomingEdge(
    edge: EdgeHash,
    previous: ?(EdgeHash | null),
  ): EdgeHash | null {
    if (previous !== undefined) {
      this.edges[hashToIndex(edge) + PREV_IN] = previous ?? 0;
    }
    let hash = this.edges[hashToIndex(edge) + PREV_IN];
    return hash ? hash : null;
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
    if (this.numNodes >= this.nodeCapacity) {
      // The size of `nodes` doubles every time we reach the current capacity.
      // This means in the worst case, we will have `O(n - 1)` _extra_
      // space allocated where `n` is a number nodes that is 1 more
      // than the previous capacity.
      this.resizeNodes(this.nodeCapacity * 2);
    }
    return toNodeId(id);
  }

  /**
   * Adds an edge to the graph.
   *
   * Returns `true` if the edge was added,
   * or `false` if the edge already exists.
   */
  addEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): boolean {
    if (fromNodeId(from) < 0 || fromNodeId(from) >= this.numNodes) {
      throw new Error(`Unknown node ${String(from)}`);
    }
    if (fromNodeId(to) < 0 || fromNodeId(to) >= this.numNodes) {
      throw new Error(`Unknown node ${String(to)}`);
    }
    if (type <= 0) throw new Error(`Unsupported edge type ${0}`);

    // The percentage of utilization of the total capacity of `edges`.
    let load = (this.numEdges + 1) / this.edgeCapacity;
    // If we're in danger of overflowing the `edges` array, resize it.
    if (load > 0.7) {
      // The size of `edges` doubles every time we reach the current capacity.
      // This means in the worst case, we will have `O(n - 1)` _extra_
      // space allocated where `n` is a number edges that is 1 more
      // than the previous capacity.
      this.resizeEdges(this.edgeCapacity * 2);
    }

    // We use the hash of the edge as the index for the edge.
    let index = this.indexFor(from, to, type);

    if (index === -1) {
      // The edge is already in the graph; do nothing.
      return false;
    }

    this.numEdges++;

    this.edges[index + TYPE] = type;
    this.edges[index + FROM] = fromNodeId(from);
    this.edges[index + TO] = fromNodeId(to);

    let edge = indexToHash(index);
    let lastIncoming = this.lastIncomingEdge(to);
    if (lastIncoming) {
      this.nextIncomingEdge(lastIncoming, edge);
      this.previousIncomingEdge(edge, lastIncoming);
    }
    this.lastIncomingEdge(to, edge);

    if (!this.firstIncomingEdge(to)) this.firstIncomingEdge(to, edge);

    let lastOutgoing = this.lastOutgoingEdge(from);
    if (lastOutgoing) {
      this.nextOutgoingEdge(lastOutgoing, edge);
      this.previousOutgoingEdge(edge, lastOutgoing);
    }
    this.lastOutgoingEdge(from, edge);

    if (!this.firstOutgoingEdge(from)) this.firstOutgoingEdge(from, edge);

    this.fromTypeMap
      ?.get(from)
      .get(type)
      .add(to);

    this.toTypeMap
      ?.get(to)
      .get(type)
      .add(from);

    return true;
  }

  /**
   * Get the index of the edge connecting the `from` and `to` nodes.
   *
   * If an edge connecting `from` and `to` does not exist, returns `-1`.
   */
  indexOf(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): number {
    let index = hashToIndex(this.hash(from, to, type));
    // We want to avoid scanning the array forever,
    // so keep track of where we start scanning from.
    let startIndex = index;
    // Since it is possible for multiple edges to have the same hash,
    // we check that the edge at the index matching the hash is actually
    // the edge we're looking for. If it's not, we scan forward in the
    // edges array, assuming that the the edge we're looking for is close by.
    while (this.edges[index + TYPE]) {
      if (
        this.edges[index + FROM] === from &&
        this.edges[index + TO] === to &&
        (type === ALL_EDGE_TYPES || this.edges[index + TYPE] === type)
      ) {
        return index;
      } else {
        // The edge at at this index is not the edge we're looking for,
        // so scan forward to the next edge, wrapping back to
        // the beginning of the `edges` array if we overflow.
        index = (index + EDGE_SIZE) % this.edges.length;

        // We have scanned the whole array unsuccessfully.
        if (index === startIndex) break;
      }
    }

    return -1;
  }

  /**
   * Get the index at which to add an edge connecting the `from` and `to` nodes.
   *
   * If an edge connecting `from` and `to` already exists, returns `-1`,
   * otherwise, returns the index at which the edge should be added.
   *
   */
  indexFor(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): number {
    let index = hashToIndex(this.hash(from, to, type));
    // we scan the `edges` array for the next empty slot after the `index`.
    // We do this instead of simply using the `index` because it is possible
    // for multiple edges to have the same hash.
    let deletedEdge = 0;
    while (this.edges[index + TYPE]) {
      // If the edge at this index was deleted, we can reuse the slot.
      if (isDeleted(this.edges[index + TYPE])) {
        deletedEdge = index;
      } else if (
        this.edges[index + FROM] === from &&
        this.edges[index + TO] === to &&
        // if type === ALL_EDGE_TYPES, return all edges
        (type === ALL_EDGE_TYPES || this.edges[index + TYPE] === type)
      ) {
        // If this edge is already in the graph, bail out.
        return -1;
      }
      // There is already an edge at `hash`,
      // so scan forward for the next open slot to use as the the `hash`.
      // Note that each 'slot' is of size `EDGE_SIZE`.
      // Also note that we handle overflow of `edges` by wrapping
      // back to the beginning of the `edges` array.
      index = (index + EDGE_SIZE) % this.edges.length;
    }
    // If we find a deleted edge, use it. Otherwise, use the next empty edge
    return deletedEdge ? deletedEdge : index;
  }

  *getAllEdges(): Iterator<{|
    type: TEdgeType | NullEdgeType,
    from: NodeId,
    to: NodeId,
  |}> {
    for (let from of this.iterateNodes()) {
      for (let edge of this.iterateOutgoingEdges(from)) {
        yield {type: this.getEdgeType(edge), from, to: this.getToNode(edge)};
      }
    }
  }

  /**
   * Check if the graph has an edge connecting the `from` and `to` nodes.
   */
  hasEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): boolean {
    return this.indexOf(from, to, type) !== -1;
  }

  /**
   *
   */
  removeEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): void {
    let index = this.indexOf(from, to, type);
    if (index === -1) {
      // The edge is not in the graph; do nothing.
      return;
    }

    /** The removed edge. */
    let edge = indexToHash(index);
    /** The first incoming edge to the removed edge's terminus. */
    let firstIncoming = this.firstIncomingEdge(to);
    /** The last incoming edge to the removed edge's terminus. */
    let lastIncoming = this.lastIncomingEdge(to);
    /** The next incoming edge after the removed edge. */
    let nextIncoming = this.nextIncomingEdge(edge);
    /** The previous incoming edge before the removed edge. */
    let previousIncoming = this.previousIncomingEdge(edge);
    /** The first outgoing edge from the removed edge's origin. */
    let firstOutgoing = this.firstOutgoingEdge(from);
    /** The last outgoing edge from the removed edge's origin. */
    let lastOutgoing = this.lastOutgoingEdge(from);
    /** The next outgoing edge after the removed edge. */
    let nextOutgoing = this.nextOutgoingEdge(edge);
    /** The previous outgoing edge before the removed edge. */
    let previousOutgoing = this.previousOutgoingEdge(edge);

    // Update the terminating node's first and last incoming edges.
    if (firstIncoming === edge) this.firstIncomingEdge(to, nextIncoming);
    if (lastIncoming === edge) this.lastIncomingEdge(to, previousIncoming);

    // Update the originating node's first and last outgoing edges.
    if (firstOutgoing === edge) this.firstOutgoingEdge(from, nextOutgoing);
    if (lastOutgoing === edge) this.lastOutgoingEdge(from, previousOutgoing);

    // Splice the removed edge out of the linked list of outgoing edges.
    if (previousOutgoing) this.nextOutgoingEdge(previousOutgoing, nextOutgoing);
    if (nextOutgoing) this.previousOutgoingEdge(nextOutgoing, previousOutgoing);

    // Splice the removed edge out of the linked list of incoming edges.
    if (previousIncoming) this.nextIncomingEdge(previousIncoming, nextIncoming);
    if (nextIncoming) this.previousIncomingEdge(nextIncoming, previousIncoming);

    this.fromTypeMap
      ?.get(from)
      .get(type)
      .delete(to);

    this.toTypeMap
      ?.get(to)
      .get(type)
      .delete(from);

    // Mark this slot as DELETED.
    // We do this so that clustered edges can still be found
    // by scanning forward in the array from the first index for
    // the cluster.
    this.edges[index + TYPE] = DELETED;
    this.edges[index + FROM] = 0;
    this.edges[index + TO] = 0;
    this.edges[index + PREV_IN] = 0;
    this.edges[index + PREV_OUT] = 0;
    this.edges[index + NEXT_IN] = 0;
    this.edges[index + NEXT_OUT] = 0;

    this.numEdges--;
  }

  *getInboundEdgesByType(
    to: NodeId,
  ): Iterator<{|type: TEdgeType, from: NodeId|}> {
    if (!this.toTypeMap) this.buildTypeMaps();
    for (let [type, nodes] of this.toTypeMap.get(to)) {
      for (let from of nodes) {
        yield {type: (type: any), from};
      }
    }
  }

  *getOutboundEdgesByType(
    from: NodeId,
  ): Iterator<{|type: TEdgeType, to: NodeId|}> {
    if (!this.fromTypeMap) this.buildTypeMaps();
    for (let [type, nodes] of this.fromTypeMap.get(from)) {
      for (let to of nodes) {
        yield {type: (type: any), to};
      }
    }
  }

  /**
   *
   */
  getEdges(
    from: NodeId,
    type:
      | AllEdgeTypes
      | TEdgeType
      | NullEdgeType
      | Array<TEdgeType | NullEdgeType> = 1,
  ): $ReadOnlySet<NodeId> {
    return new Set(this.getNodesConnectedFrom(from, type));
  }

  /**
   * Get the list of nodes connected from this node.
   */
  *getNodesConnectedFrom(
    from: NodeId,
    type:
      | AllEdgeTypes
      | TEdgeType
      | NullEdgeType
      | Array<TEdgeType | NullEdgeType> = 1,
  ): Iterator<NodeId> {
    if (!this.fromTypeMap || !this.toTypeMap) this.buildTypeMaps();

    let isAllEdgeTypes =
      type === ALL_EDGE_TYPES ||
      (Array.isArray(type) && type.includes(ALL_EDGE_TYPES));

    if (isAllEdgeTypes) {
      for (let [, to] of this.fromTypeMap.get(from)) {
        yield* to;
      }
    } else if (Array.isArray(type)) {
      for (let typeNum of type) {
        yield* this.fromTypeMap
          .get(from)
          .get((typeNum: any))
          .values();
      }
    } else {
      yield* this.fromTypeMap
        .get(from)
        .get((type: any))
        .values();
    }
  }

  /**
   * Get the list of nodes connected to this node.
   */
  *getNodesConnectedTo(
    to: NodeId,
    type:
      | AllEdgeTypes
      | TEdgeType
      | NullEdgeType
      | Array<TEdgeType | NullEdgeType> = 1,
  ): Iterator<NodeId> {
    if (!this.fromTypeMap || !this.toTypeMap) this.buildTypeMaps();

    let isAllEdgeTypes =
      type === ALL_EDGE_TYPES ||
      (Array.isArray(type) && type.includes(ALL_EDGE_TYPES));

    if (isAllEdgeTypes) {
      for (let [, from] of this.toTypeMap.get(to)) {
        yield* from;
      }
    } else if (Array.isArray(type)) {
      for (let typeNum of type) {
        yield* this.toTypeMap
          .get(to)
          .get((typeNum: any))
          .values();
      }
    } else {
      yield* this.toTypeMap
        .get(to)
        .get((type: any))
        .values();
    }
  }

  /**
   * Create a hash of the edge connecting the `from` and `to` nodes.
   *
   * This hash is used to index the edge in the `edges` array.
   *
   */
  hash(from: NodeId, to: NodeId, type: TEdgeType | NullEdgeType): EdgeHash {
    // A crude multiplicative hash, in 4 steps:
    // 1. Serialize the args into an integer that reflects the argument order,
    // shifting the magnitude of each argument by the sum
    // of the significant digits of the following arguments,
    // .e.g., `hash(10, 24, 4) => 10244`.
    // $FlowFixMe[unsafe-addition]
    // $FlowFixMe[incompatible-type]
    let hash = '' + from + to + type - 0;
    // 2. Map the hash to a value modulo the edge capacity.
    hash %= this.edgeCapacity;
    // 3. Multiply by EDGE_SIZE to select a valid index.
    hash *= EDGE_SIZE;
    // 4. Add 1 to guarantee a truthy result.
    return hash + 1;
  }

  toDot(type: 'graph' | 'edges' | 'nodes' = 'graph'): string {
    switch (type) {
      case 'edges':
        return edgesToDot(this);
      case 'nodes':
        return nodesToDot(this);
      default:
        return toDot(this);
    }
  }

  printNode(id: NodeId): string {
    return `Node [${fromNodeId(id)}]`;
  }

  printEdge(hash: EdgeHash): string {
    const from = this.getFromNode(hash);
    const to = this.getToNode(hash);
    const type = this.getEdgeType(hash);
    return `Edge [${hash}] (${type}) { ${[from, '=>', to].join(' ')} }`;
  }
}

let nodeColor = {color: 'black', fontcolor: 'black'};
let emptyColor = {color: 'darkgray', fontcolor: 'darkgray'};
let edgeColor = {color: 'brown', fontcolor: 'brown'};

function toDot<TEdgeType: number>(data: AdjacencyList<TEdgeType>): string {
  let g = digraph('G');
  g.set('rankdir', 'LR');
  g.setNodeAttribut('fontsize', 8);
  g.setNodeAttribut('height', 0);
  g.setNodeAttribut('shape', 'square');
  g.setEdgeAttribut('fontsize', 8);
  g.setEdgeAttribut('arrowhead', 'open');

  let graph = g.addCluster('clusterGraph');
  graph.set('label', 'Graph');
  graph.setEdgeAttribut('color', edgeColor.color);
  graph.setEdgeAttribut('fontcolor', edgeColor.fontcolor);

  let adjacencyList = g.addCluster('clusterAdjacencyList');
  adjacencyList.set('label', 'AdjacencyList');
  adjacencyList.setNodeAttribut('shape', 'record');
  adjacencyList.setNodeAttribut('color', edgeColor.color);
  adjacencyList.setNodeAttribut('fontcolor', edgeColor.color);
  adjacencyList.setEdgeAttribut('color', edgeColor.color);
  adjacencyList.setEdgeAttribut('fontcolor', edgeColor.color);
  adjacencyList.setEdgeAttribut('fontsize', 6);

  for (let i = 0; i < data.nodes.length; i += NODE_SIZE) {
    let firstIn = data.nodes[i + FIRST_IN];
    let firstOut = data.nodes[i + FIRST_OUT];

    if (!firstIn && !firstOut) continue;

    adjacencyList.addNode(`node${String(nodeAt(i))}`, {
      label: `node ${String(
        nodeAt(i),
      )} | { <FIRST_IN> ${firstIn} | <FIRST_OUT> ${firstOut} }`,
      ...nodeColor,
    });

    if (firstIn) {
      adjacencyList.addEdge(`node${String(nodeAt(i))}`, `edge${firstIn}`, {
        tailport: 'FIRST_IN',
        label: 'FIRST_IN',
        ...nodeColor,
      });
    }

    if (firstOut) {
      adjacencyList.addEdge(`node${String(nodeAt(i))}`, `edge${firstOut}`, {
        tailport: 'FIRST_OUT',
        label: 'FIRST_OUT',
        ...nodeColor,
      });
    }

    let nextEdge = firstOut;
    while (nextEdge) {
      let index = hashToIndex(nextEdge);
      let type = data.edges[index + TYPE];
      let from = data.edges[index + FROM];
      let to = data.edges[index + TO];
      let prevIn = data.edges[index + PREV_IN];
      let prevOut = data.edges[index + PREV_OUT];
      let nextIn = data.edges[index + NEXT_IN];
      let nextOut = data.edges[index + NEXT_OUT];
      // TODO: add type to label?
      let label = String(nextEdge);

      graph.addEdge(
        String(nodeAt(i)),
        String(data.edges[hashToIndex(nextEdge) + TO]),
        {label},
      );

      adjacencyList.addNode(`edge${label}`, {
        label: `edge ${label} | { <TYPE> ${type} | <FROM> ${from} | <TO> ${to} | <PREV_IN> ${prevIn} | <PREV_OUT> ${prevOut} | <NEXT_IN> ${nextIn} | <NEXT_OUT> ${nextOut} }`,
      });

      adjacencyList.addEdge(`edge${label}`, `node${from}`, {
        tailport: 'FROM',
        label: 'FROM',
        style: 'dashed',
      });

      adjacencyList.addEdge(`edge${label}`, `node${to}`, {
        label: 'TO',
        tailport: 'TO',
      });

      if (nextIn) {
        adjacencyList.addEdge(`edge${label}`, `edge${nextIn}`, {
          tailport: 'NEXT_IN',
          label: 'NEXT_IN',
          style: 'dashed',
        });
      }

      if (nextOut) {
        adjacencyList.addEdge(`edge${label}`, `edge${nextOut}`, {
          label: 'NEXT_OUT',
          tailport: 'NEXT_OUT',
        });
      }

      nextEdge = nextOut;
    }
  }

  return g.to_dot();
}

function nodesToDot<TEdgeType: number>(data: AdjacencyList<TEdgeType>): string {
  let g = digraph('G');
  g.set('rankdir', 'LR');
  g.set('nodesep', 0);
  g.set('ranksep', 0);
  g.setNodeAttribut('fontsize', 8);
  g.setNodeAttribut('height', 0);
  g.setNodeAttribut('shape', 'square');
  g.setEdgeAttribut('fontsize', 8);
  g.setEdgeAttribut('arrowhead', 'open');

  let nodes = g.addCluster('clusterNodes');
  nodes.set('label', 'Nodes');
  nodes.setNodeAttribut('shape', 'record');
  nodes.setEdgeAttribut('fontsize', 6);
  nodes.setEdgeAttribut('style', 'invis');

  let lastOut = 0;
  for (let i = 0; i < data.nodes.length; i += NODE_SIZE) {
    let firstIn = data.nodes[i + FIRST_IN];
    let firstOut = data.nodes[i + FIRST_OUT];
    if (firstIn || firstOut) {
      if (lastOut < i - NODE_SIZE) {
        if (lastOut === 0) {
          nodes.addNode(`node${lastOut}`, {
            label: `${lastOut}…${i - NODE_SIZE} | `,
            ...emptyColor,
          });
        } else {
          nodes.addNode(`node${lastOut + NODE_SIZE}`, {
            label: `${lastOut + NODE_SIZE}…${i - NODE_SIZE} | `,
            ...emptyColor,
          });
          nodes.addEdge(`node${lastOut}`, `node${lastOut + NODE_SIZE}`);
          lastOut += NODE_SIZE;
        }
      }

      nodes.addNode(`node${i}`, {
        label: `${fromNodeId(nodeAt(i))} | {${firstIn} | ${firstOut}}`,
      });

      nodes.addEdge(`node${lastOut}`, `node${i}`);
      lastOut = i;
    } else if (i === data.nodes.length - NODE_SIZE) {
      if (lastOut < i - NODE_SIZE) {
        if (lastOut === 0) {
          nodes.addNode(`node${lastOut}`, {
            label: `${lastOut}…${i - NODE_SIZE} | `,
            ...emptyColor,
          });
        } else {
          nodes.addNode(`node${lastOut + NODE_SIZE}`, {
            label: `${lastOut + NODE_SIZE}…${i - NODE_SIZE} | `,
            ...emptyColor,
          });
          nodes.addEdge(`node${lastOut}`, `node${lastOut + NODE_SIZE}`);
        }
      }
    }
  }

  return g.to_dot();
}

function edgesToDot<TEdgeType: number>(data: AdjacencyList<TEdgeType>): string {
  let g = digraph('G');
  g.set('rankdir', 'LR');
  g.set('nodesep', 0);
  g.set('ranksep', 0);
  g.setNodeAttribut('fontsize', 8);
  g.setNodeAttribut('height', 0);
  g.setNodeAttribut('shape', 'square');
  g.setEdgeAttribut('fontsize', 8);
  g.setEdgeAttribut('arrowhead', 'open');

  let edges = g.addCluster('clusterEdges');
  edges.set('label', 'Edges');
  edges.setNodeAttribut('shape', 'record');
  edges.setEdgeAttribut('fontsize', 6);
  edges.setEdgeAttribut('style', 'invis');

  let lastOut = 0;
  for (let i = 0; i < data.edges.length; i += EDGE_SIZE) {
    let type = data.edges[i + TYPE];
    if (type && !isDeleted(type)) {
      let from = data.edges[i + FROM];
      let to = data.edges[i + TO];
      let prevIn = data.edges[i + PREV_IN];
      let prevOut = data.edges[i + PREV_OUT];
      let nextIn = data.edges[i + NEXT_IN];
      let nextOut = data.edges[i + NEXT_OUT];

      if (lastOut < i - EDGE_SIZE) {
        if (lastOut || data.edges[lastOut + TYPE]) {
          edges.addNode(`edge${lastOut + EDGE_SIZE}`, {
            label: `${lastOut + EDGE_SIZE}…${i - 1} | `,
            ...emptyColor,
          });
          edges.addEdge(`edge${lastOut}`, `edge${lastOut + EDGE_SIZE}`);
          lastOut += EDGE_SIZE;
        } else if (i && !data.edges[lastOut + TYPE]) {
          edges.addNode(`edge${lastOut}`, {
            label: `${lastOut}…${i - 1} | `,
            ...emptyColor,
          });
        }
      }

      edges.addNode(`edge${i}`, {
        label: `${indexToHash(
          i,
        )} | {${type} | ${from} | ${to} | ${prevIn} | ${prevOut} | ${nextIn} | ${nextOut}}`,
      });

      if (lastOut !== i) {
        edges.addEdge(`edge${lastOut}`, `edge${i}`);
        lastOut = i;
      }
    } else if (i === data.edges.length - EDGE_SIZE) {
      if (lastOut <= i - EDGE_SIZE) {
        if (lastOut || data.edges[lastOut + TYPE]) {
          edges.addNode(`edge${lastOut + EDGE_SIZE}`, {
            label: `${lastOut + EDGE_SIZE}…${i + EDGE_SIZE - 1} | `,
            ...emptyColor,
          });
          edges.addEdge(`edge${lastOut}`, `edge${lastOut + EDGE_SIZE}`);
        } else {
          edges.addNode(`edge${lastOut}`, {
            label: `${lastOut}…${i + EDGE_SIZE - 1} | `,
            ...emptyColor,
          });
        }
      }
    }
  }

  return g.to_dot();
}

export function openGraphViz<TEdgeType: number>(
  data: AdjacencyList<TEdgeType>,
  type?: 'graph' | 'nodes' | 'edges',
): Promise<void> {
  if (!type) {
    return Promise.all([
      openGraphViz(data, 'nodes'),
      openGraphViz(data, 'edges'),
      openGraphViz(data, 'graph'),
    ]).then(() => void 0);
  }
  let preview = spawn('open', ['-a', 'Preview.app', '-f'], {stdio: ['pipe']});
  let result = new Promise((resolve, reject) => {
    preview.on('close', code => {
      if (code) reject(`process exited with code ${code}`);
      else resolve();
    });
  });

  let dot = spawn('dot', ['-T', 'png'], {stdio: ['pipe']});
  dot.stdout.pipe(preview.stdin);
  dot.stdin.write(data.toDot(type));
  dot.stdin.end();
  return result;
}
