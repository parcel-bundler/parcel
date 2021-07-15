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
 * The fourth 4 bytes are an XOR of the hashes of the 'to' node's next and previous incoming edges.
 * The fifth 4 bytes are an XOR of the hashes of the 'from' node's next and previous outgoing edges.
 *
 * struct Edge {
 *   int type;
 *   int from;
 *   int to;
 *   int in;
 *   int out;
 * }
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                           EDGE_SIZE                            │
 * ├────────────┬────────────┬────────────┬────────────┬────────────┤
 * │    TYPE    │    FROM    │     TO     │     IN     │     OUT    │
 * └────────────┴────────────┴────────────┴────────────┴────────────┘
 *
 * Nodes and Edges create an XOR doubly-linked list
 * for outgoing and incoming edges to and from each node.
 *
 * For example, 3 edges from node 0 to 1 are linked thusly:
 *
 *                 ┌───────┐
 *                 │ Node0 │
 *         ┌───────┴───┬───┴───────┐
 *      ┌──│FirstOut(1)│LastOut(3) │──┐
 *      ▼  └───────────┴───────────┘  ▼
 *  ┌───────┐                     ┌───────┐
 *  │ Edge1 │◀─┐   ┌───────┐   ┌─▶│ Edge3 │
 * ┌┴───────┴┐ │┌─▶│ Edge2 │◀─┐│ ┌┴───────┴┐
 * │Out(0^2) │─┼┤ ┌┴───────┴┐ ├┼─│Out(2^0) │
 * ├─────────┤ ├┼─│Out(1^3) │─┼┤ ├─────────┤
 * │ In(0^2) │─┼┘ ├─────────┤ └┼─│ In(2^0) │
 * └─────────┘ └──│ In(1^3) │──┘ └─────────┘
 *      ▲         └─────────┘         ▲
 *      │  ┌───────────┬───────────┐  │
 *      └──│FirstIn(1) │ LastIn(3) │──┘
 *         └───────┬───┴───┬───────┘
 *                 │ Node1 │
 *                 └───────┘
 *
 * To traverse the outgoing edges of `Node0`, you start with `FirstOut(1)`,
 * which points to `Edge1`. Then follow the link to `Edge2` by XORing the
 * link with the previous edge (0 in this case) `Out(0^2)^0 = Edge2`.
 * Then follow the link to `Edge3` by XOR `Out(1^3)^Edge1 = Edge3`, and so on.
 *
 * The edges may be traversed in reverse by starting with `LastOut(3)`
 * and following the XOR links in the same manner, i.e. `Edge3` links
 * back to `Edge2` via `Out(2^0)^0 = Edge2`, then `Edge2` links back
 * to `Edge1` via Out(1^3)^Edge3 = Edge1`, etc.
 *
 * The incoming edges to `Node1` are similar, but starting from
 * `FirstIn(1)` or `LastIn(3)`, and following the `In()` links instead.
 */
export const EDGE_SIZE = 5;

/** The offset from an edge index at which the edge type is stored. */
const TYPE: 0 = 0;
/** The offset from an edge index at which the 'from' node id is stored. */
const FROM: 1 = 1;
/** The offset from an edge index at which the 'to' node id is stored. */
const TO: 2 = 2;
/**
 * The offset from an edge index at which an XOR of the hashes
 * of the 'to' node's next and previous incoming edges is stored.
 */
const IN: 3 = 3;
/**
 * The offset from an edge index at which an XOR of the hashes
 * of the 'from' node's next and previous outgoing edges is stored.
 */
const OUT: 4 = 4;

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
  fromTypeMap: ?DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>;
  /** A map of node ids to => through types => from node ids. */
  toTypeMap: ?DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>;

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
    let previousHash = null;
    let hash = this.firstOutgoingEdge(nodeId);
    while (hash) {
      yield hash;
      let nextHash = this.getLinkedEdge(OUT, hash, previousHash);
      previousHash = hash;
      hash = nextHash;
    }
  }

  /** Iterate over incoming edge hashes to the given `nodeId` the `AdjacencyList`. */
  *iterateIncomingEdges(nodeId: NodeId): Iterator<EdgeHash> {
    let previousHash = null;
    let hash = this.firstIncomingEdge(nodeId);
    while (hash) {
      yield hash;
      let nextHash = this.getLinkedEdge(IN, hash, previousHash);
      previousHash = hash;
      hash = nextHash;
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
  buildTypeMaps(): {|
    fromTypeMap: DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>,
    toTypeMap: DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>,
  |} {
    let fromTypeMap = new DefaultMap(() => new DefaultMap(() => new Set()));
    let toTypeMap = new DefaultMap(() => new DefaultMap(() => new Set()));
    for (let node of this.iterateNodes()) {
      for (let edge of this.iterateOutgoingEdges(node)) {
        fromTypeMap
          .get(node)
          .get(this.getEdgeType(edge))
          .add(this.getToNode(edge));
      }
      for (let edge of this.iterateIncomingEdges(node)) {
        toTypeMap
          .get(node)
          .get(this.getEdgeType(edge))
          .add(this.getFromNode(edge));
      }
    }
    this.fromTypeMap = fromTypeMap;
    this.toTypeMap = toTypeMap;
    return {fromTypeMap, toTypeMap};
  }

  getOrCreateFromTypeMap(): DefaultMap<
    NodeId,
    DefaultMap<number, Set<NodeId>>,
  > {
    return this.fromTypeMap || this.buildTypeMaps().fromTypeMap;
  }

  getOrCreateToTypeMap(): DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>> {
    return this.toTypeMap || this.buildTypeMaps().toTypeMap;
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

  /** Insert the given `edge` between `previous` and `next` edges.  */
  linkEdge(
    direction: typeof IN | typeof OUT,
    prev: EdgeHash | null,
    edge: EdgeHash,
    next: EdgeHash | null,
  ): void {
    // We need `prev-1` to compute the new link between `prev` to `edge`.
    let prev1 = this.getLinkedEdge(direction, prev, next) ?? 0;
    // We need `next+1` to compute the new link between `edge` to `next`.
    let next1 = this.getLinkedEdge(direction, next, prev) ?? 0;
    prev = prev ?? 0;
    next = next ?? 0;
    if (prev) this.edges[hashToIndex(prev) + direction] = prev1 ^ edge;
    this.edges[hashToIndex(edge) + direction] = prev ^ next;
    if (next) this.edges[hashToIndex(next) + direction] = edge ^ next1;
  }

  /** Remove the given `edge` between `previous` and `next` edges. */
  unlinkEdge(
    direction: typeof IN | typeof OUT,
    prev: EdgeHash | null,
    edge: EdgeHash,
    next: EdgeHash | null,
  ): void {
    // We need `prev-1` to compute the new link between `prev` to `next`.
    let prev1 = this.getLinkedEdge(direction, prev, edge) ?? 0;
    // We need `next+1` to compute the new link between `prev` to `next`.
    let next1 = this.getLinkedEdge(direction, next, edge) ?? 0;
    prev = prev ?? 0;
    next = next ?? 0;
    if (prev) this.edges[hashToIndex(prev) + direction] = prev1 ^ next;
    this.edges[hashToIndex(edge) + direction] = 0;
    if (next) this.edges[hashToIndex(next) + direction] = prev ^ next1;
  }

  /** Get the edge linked to this edge in the given direction. */
  getLinkedEdge(
    direction: typeof IN | typeof OUT,
    edge: EdgeHash | null,
    previous: EdgeHash | null,
  ): EdgeHash | null {
    if (edge === null) return null;
    let link = this.edges[hashToIndex(edge) + direction];
    if (previous === null) return link;
    return previous ^ link;
  }

  /** Find the edge linked to the given `edge`. */
  findEdgeBefore(
    direction: typeof IN | typeof OUT,
    edge: EdgeHash,
  ): EdgeHash | null {
    let node = direction === IN ? this.getToNode(edge) : this.getFromNode(edge);

    let left =
      direction === IN
        ? this.firstIncomingEdge(node)
        : this.firstOutgoingEdge(node);

    if (edge === left) return null;

    let right =
      direction === IN
        ? this.lastIncomingEdge(node)
        : this.lastOutgoingEdge(node);

    let lastLeft = null;
    let lastRight = null;
    while (left || right) {
      if (left) {
        let nextLeft =
          direction === IN
            ? this.getLinkedEdge(IN, left, lastLeft)
            : this.getLinkedEdge(OUT, left, lastLeft);
        if (nextLeft === edge) return left;
        lastLeft = left;
        left = nextLeft;
      }
      if (right) {
        let nextRight =
          direction === IN
            ? this.getLinkedEdge(IN, right, lastRight)
            : this.getLinkedEdge(OUT, right, lastRight);
        if (right === edge) return nextRight;
        lastRight = right;
        right = nextRight;
      }
    }
    return null;
  }

  /** Find the edge the given `edge` is linked to. */
  findEdgeAfter(
    direction: typeof IN | typeof OUT,
    edge: EdgeHash,
  ): EdgeHash | null {
    let node = direction === IN ? this.getToNode(edge) : this.getFromNode(edge);

    let right =
      direction === IN
        ? this.lastIncomingEdge(node)
        : this.lastOutgoingEdge(node);

    if (edge === right) return null;

    let left =
      direction === IN
        ? this.firstIncomingEdge(node)
        : this.firstOutgoingEdge(node);

    let lastRight = null;
    let lastLeft = null;
    while (right || left) {
      if (right) {
        let nextRight =
          direction === IN
            ? this.getLinkedEdge(IN, right, lastRight)
            : this.getLinkedEdge(OUT, right, lastRight);
        if (nextRight === edge) return right;
        lastRight = right;
        right = nextRight;
      }
      if (left) {
        let nextLeft =
          direction === IN
            ? this.getLinkedEdge(IN, left, lastLeft)
            : this.getLinkedEdge(OUT, left, lastLeft);
        if (left === edge) return nextLeft;
        lastLeft = left;
        left = nextLeft;
      }
    }
    return null;
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
    let firstIncoming = this.firstIncomingEdge(to);
    let lastIncoming = this.lastIncomingEdge(to);
    let firstOutgoing = this.firstOutgoingEdge(from);
    let lastOutgoing = this.lastOutgoingEdge(from);

    // If the `to` node has incoming edges, link the last edge to this one.
    // from: lastIncoming <=> null
    // to: lastIncoming <=> edge <=> null
    if (lastIncoming) this.linkEdge(IN, lastIncoming, edge, null);
    // Set this edge as the last incoming edge to the `to` node.
    this.lastIncomingEdge(to, edge);
    // If the `to` node has no incoming edges, set this edge as the first one.
    if (!firstIncoming) this.firstIncomingEdge(to, edge);

    // If the `from` node has outgoing edges, link the last edge to this one.
    // from: lastOutgoing <=> null
    // to: lastOutgoing <=> edge <=> null
    if (lastOutgoing) this.linkEdge(OUT, lastOutgoing, edge, null);
    // Set this edge as the last outgoing edge from the `from` node.
    this.lastOutgoingEdge(from, edge);
    // If the `from` node has no outgoing edges, set this edge as the first one.
    if (!firstOutgoing) this.firstOutgoingEdge(from, edge);

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
    let size = this.edges.length;
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
        index = (index + EDGE_SIZE) % size;

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
    let size = this.edges.length;
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
      index = (index + EDGE_SIZE) % size;
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
    let firstIn = this.firstIncomingEdge(to);
    /** The last incoming edge to the removed edge's terminus. */
    let lastIn = this.lastIncomingEdge(to);
    /** The next incoming edge after the removed edge. */
    let nextIn = this.findEdgeAfter(IN, edge);
    /** The previous incoming edge before the removed edge. */
    let previousIn = this.findEdgeBefore(IN, edge);
    /** The first outgoing edge from the removed edge's origin. */
    let firstOut = this.firstOutgoingEdge(from);
    /** The last outgoing edge from the removed edge's origin. */
    let lastOut = this.lastOutgoingEdge(from);
    /** The next outgoing edge after the removed edge. */
    let nextOut = this.findEdgeAfter(OUT, edge);
    /** The previous outgoing edge before the removed edge. */
    let previousOut = this.findEdgeBefore(OUT, edge);

    // Splice the removed edge out of the linked list of incoming edges.
    // from: previousIn <=> edge <=> nextIn
    // to: previousIn <=> nextIn
    this.unlinkEdge(IN, previousIn, edge, nextIn);

    // Splice the removed edge out of the linked list of outgoing edges.
    // from: previousOut <=> edge <=> nextOut
    // to: previousOut <=> nextOut
    this.unlinkEdge(OUT, previousOut, edge, nextOut);

    // Update the terminating node's first and last incoming edges.
    if (firstIn === edge) this.firstIncomingEdge(to, nextIn);
    if (lastIn === edge) this.lastIncomingEdge(to, previousIn);

    // Update the originating node's first and last outgoing edges.
    if (firstOut === edge) this.firstOutgoingEdge(from, nextOut);
    if (lastOut === edge) this.lastOutgoingEdge(from, previousOut);

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
    this.edges[index + IN] = 0;
    this.edges[index + OUT] = 0;

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
      let nextIn = data.edges[index + IN];
      let nextOut = data.edges[index + OUT];
      // TODO: add type to label?
      let label = String(nextEdge);

      graph.addEdge(
        String(nodeAt(i)),
        String(data.edges[hashToIndex(nextEdge) + TO]),
        {label},
      );

      adjacencyList.addNode(`edge${label}`, {
        label: `edge ${label} | { <TYPE> ${type} | <FROM> ${from} | <TO> ${to} | <IN> ${nextIn} | <OUT> ${nextOut} }`,
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
          tailport: 'IN',
          label: 'IN',
          style: 'dashed',
        });
      }

      if (nextOut) {
        adjacencyList.addEdge(`edge${label}`, `edge${nextOut}`, {
          label: 'OUT',
          tailport: 'OUT',
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
      let inLink = data.edges[i + IN];
      let outLink = data.edges[i + OUT];

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
        )} | {${type} | ${from} | ${to} | ${inLink} | ${outLink}}`,
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
