// @flow
import assert from 'assert';
import {fromNodeId, toNodeId} from './types';
import type {NullEdgeType, AllEdgeTypes} from './Graph';
import type {NodeId} from './types';

/**
 * Nodes are stored in a shared array buffer of fixed length
 * equal to the node `capacity * NODE_SIZE + NODES_HEADER_SIZE`.
 *
 *                            nodes
 *                    (capacity * NODE_SIZE)
 *             ┌────────────────┴──────────────┐
 *       ┌──┬──┬──┬──┬──┬──┬───────┬──┬──┬──┬──┐
 *       │  │  │  │  │  │  │  ...  │  │  │  │  │
 *       └──┴──┴──┴──┴──┴──┴───────┴──┴──┴──┴──┘
 *       └──┬──┘                   └─────┬─────┘
 *        header                        node
 * (NODES_HEADER_SIZE)              (NODE_SIZE)
 *
 * The header for the nodes array comprises 2 4-byte chunks:
 * The first 4 bytes store the node capacity.
 * The second 4 bytes store the number of nodes in the adjacency list.

 * struct NodesHeader {
 *   int capacity;
 *   int count;
 * }
 *
 * ┌────────────────────────┐
 * │    NODES_HEADER_SIZE   │
 * ├────────────┬───────────┤
 * │  CAPACITY  │   COUNT   │
 * └────────────┴───────────┘
 *
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
export const NODE_SIZE: 4 = 4;
/** The size of nodes array header */
export const NODES_HEADER_SIZE: 2 = 2;

/**
 * Edges are stored in a shared array buffer of fixed length
 * equal to the edge `capacity + capacity * EDGE_SIZE + EDGES_HEADER_SIZE`.
 *
 *                  hash table                                   edge
 *                  (capacity)                               (EDGE_SIZE)
 *               ┌──────┴──────┐                         ┌────────┴────────┐
 *      ┌──┬──┬──┬──┬───────┬──┬──┬──┬──┬──┬──┬──┬───────┬──┬──┬──┬──┬──┬──┐
 *      │  │  │  │  │  ...  │  │  │  │  │  │  │  │  ...  │  │  │  │  │  │  │
 *      └──┴──┴──┴──┴───────┴──┴──┴──┴──┴──┴──┴──┴───────┴──┴──┴──┴──┴──┴──┘
 *      └───┬────┘             ├─────────────────────┬─────────────────────┘
 *        header        addressableLimit           edges
 * (EDGES_HEADER_SIZE)                     (capacity * EDGE_SIZE)
 *
 * The header for the edges array comprises 3 4-byte chunks:
 * The first 4 bytes store the edge capacity.
 * The second 4 bytes store the number of edges in the adjacency list.
 * The third 4 bytes store the number of deleted edges.
 *
 * struct NodesHeader {
 *   int capacity;
 *   int count;
 *   int deletes;
 * }
 *
 * ┌────────────────────────────────────┐
 * │          EDGES_HEADER_SIZE         │
 * ├────────────┬───────────┬───────────┤
 * │  CAPACITY  │   COUNT   │  DELETES  │
 * └────────────┴───────────┴───────────┘
 *
 * Each edge is represented with 5 4-byte chunks:
 * The first 4 bytes are the edge type.
 * The second 4 bytes are the id of the 'from' node.
 * The third 4 bytes are the id of the 'to' node.
 * The fourth 4 bytes are the index of the next edge in the bucket of hash collisions.
 * The fifth 4 bytes are the hash of the 'to' node's next incoming edge.
 * The sixth 4 bytes are the hash of the 'from' node's next outgoing edge.
 *
 * struct Edge {
 *   int type;
 *   int from;
 *   int to;
 *   int nextHash;
 *   int nextIn;
 *   int nextOut;
 * }
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                                  EDGE_SIZE                                  │
 * ├────────────┬────────────┬────────────┬────────────┬────────────┬────────────┤
 * │    TYPE    │    FROM    │     TO     │  NEXT_HASH │   NEXT_IN  │  NEXT_OUT  │
 * └────────────┴────────────┴────────────┴────────────┴────────────┴────────────┘
 *
 * Nodes and Edges create a linked list of edges to and from each node.
 *
 * For example, 3 edges from node 0 to 1 are linked thusly:
 *
 *                     ┌───────┐
 *                     │ Node0 │
 *             ┌───────┴───┬───┴───────┐
 *        ┌────│FirstOut(1)│LastOut(3) │────┐
 *        ▼    └───────────┴───────────┘    ▼
 *    ┌───────┐                         ┌───────┐
 * ┌─▶│ Edge1 │        ┌───────┐    ┌──▶│ Edge3 │◀─┐
 * │┌─┴───────┴─┐  ┌──▶│ Edge2 │    │ ┌─┴───────┴─┐│
 * ││ NextIn(2) │──┤ ┌─┴───────┴─┐  │ │ NextIn(0) ││
 * │├───────────┤  │ │ NextIn(3) │──┤ ├───────────┤│
 * ││NextOut(2) │──┘ ├───────────┤  │ │NextOut(0) ││
 * │└───────────┘    │NextOut(3) │──┘ └───────────┘│
 * │                 └───────────┘                 │
 * │           ┌───────────┬───────────┐           │
 * └───────────│FirstIn(1) │ LastIn(3) │───────────┘
 *             └───────┬───┴───┬───────┘
 *                     │ Node1 │
 *                     └───────┘
 *
 * To traverse the outgoing edges of `Node0`, you start with `FirstOut(1)`,
 * which points to `Edge1`. Then follow the link to `Edge2` via `NextOut(2)`.
 * Then follow the link to `Edge3` via `NextOut(3)`, and so on.
 *
 * The incoming edges to `Node1` are similar, but starting from
 * `FirstIn(1)` and following the `NextIn()` links instead.
 */
export const EDGE_SIZE: 6 = 6;
/** The size of the edges array header */
export const EDGES_HEADER_SIZE: 3 = 3;

/** The offset from the header where the capacity is stored. */
const CAPACITY: 0 = 0;
/** The offset from the header where the count is stored. */
export const COUNT: 1 = 1;
/** The offset from the header where the delete count is stored. */
const DELETES: 2 = 2;

/** The offset from an edge index at which the edge type is stored. */
const TYPE: 0 = 0;
/** The offset from an edge index at which the 'from' node id is stored. */
const FROM: 1 = 1;
/** The offset from an edge index at which the 'to' node id is stored. */
const TO: 2 = 2;
/** The offset from an edge index at which the next edge in the chain of hash collisions is stored*/
const NEXT_HASH: 3 = 3;
/**
 * The offset from an edge index at which the hash
 * of the 'to' node's next incoming edge is stored.
 */
const NEXT_IN: 4 = 4;
/**
 * The offset from an edge index at which the hash
 * of the 'from' node's next outgoing edge is stored.
 */
const NEXT_OUT: 5 = 5;

/** The offset from a node index at which the hash of the first incoming edge is stored. */
const FIRST_IN: 0 = 0;
/** The offset from a node index at which the hash of the first outgoing edge is stored. */
const FIRST_OUT: 1 = 1;
/** The offset from a node index at which the hash of the last incoming edge is stored. */
const LAST_IN: 2 = 2;
/** The offset from a node index at which the hash of the last outgoing edge is stored. */
const LAST_OUT: 3 = 3;

/** The upper bound above which the edge capacity should be increased. */
const LOAD_FACTOR = 0.7;
/** The lower bound below which the edge capacity should be decreased. */
const UNLOAD_FACTOR = 0.3;
/** The smallest functional node or edge capacity. */
const MIN_CAPACITY = 256;
/** How many edges to accommodate in a hash bucket. */
const BUCKET_SIZE = 2;

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
|};

// eslint-disable-next-line no-unused-vars
export type AdjacencyListOptions<TEdgeType> = {|
  edgeCapacity?: number,
  nodeCapacity?: number,
|};

opaque type EdgeHash = number;

/** The index of the edge in the edges array. */
opaque type EdgeIndex = number;

// From https://gist.github.com/badboy/6267743#32-bit-mix-functions
function hash32shift(key: number): number {
  key = ~key + (key << 15); // key = (key << 15) - key - 1;
  key = key ^ (key >> 12);
  key = key + (key << 2);
  key = key ^ (key >> 4);
  key = key * 2057; // key = (key + (key << 3)) + (key << 11);
  key = key ^ (key >> 16);
  return key;
}

/** Get the index in the hash table for the given hash. */
function hashToIndex(hash: EdgeHash) {
  return hash + EDGES_HEADER_SIZE;
}

/** Get the id of the node at the given index in the nodes array. */
function nodeAt(index: number): NodeId {
  index -= NODES_HEADER_SIZE;
  return toNodeId((index - (index % NODE_SIZE)) / NODE_SIZE);
}

/** Get the index in the nodes array of the given node. */
function indexOfNode(id: NodeId): number {
  return NODES_HEADER_SIZE + fromNodeId(id) * NODE_SIZE;
}

function getAddressableLimit(edgeCapacity: number): number {
  return EDGES_HEADER_SIZE + edgeCapacity;
}

function getEdgesLength(edgeCapacity: number): number {
  return (
    getAddressableLimit(edgeCapacity) + edgeCapacity * EDGE_SIZE * BUCKET_SIZE
  );
}

function getNodesLength(nodeCapacity: number): number {
  return NODES_HEADER_SIZE + nodeCapacity * NODE_SIZE;
}

function increaseNodeCapacity(nodeCapacity: number): number {
  return nodeCapacity * 4;
}

function increaseEdgeCapacity(edgeCapacity: number): number {
  return edgeCapacity * 10;
}

function decreaseEdgeCapacity(edgeCapacity: number): number {
  return Math.max(0, Math.floor(edgeCapacity / 2));
}

export default class AdjacencyList<TEdgeType: number = 1> {
  /** An array of nodes, with each node occupying `NODE_SIZE` adjacent indices. */
  #nodes: Uint32Array;
  /** An array of edges, with each edge occupying `EDGE_SIZE` adjacent indices. */
  #edges: Uint32Array;
  /** A map of edge indexes to the index of their previous incoming edge */
  #previousIn: Map<EdgeIndex, EdgeIndex>;
  /** A map of edge indexes to the index of their previous outgoing edge */
  #previousOut: Map<EdgeIndex, EdgeIndex>;

  constructor(
    opts?: SerializedAdjacencyList<TEdgeType> | AdjacencyListOptions<TEdgeType>,
  ) {
    let nodes;
    let edges;

    if (opts?.nodes) {
      // We were given a serialized adjacency list,
      // so we just do a quick check of the data integrity
      // and then initialize the `AdjacencyList`.
      ({nodes, edges} = opts);
      assert(
        getNodesLength(nodes[CAPACITY]) === nodes.length,
        'Node data appears corrupt.',
      );

      assert(
        getEdgesLength(edges[CAPACITY]) === edges.length,
        'Edge data appears corrupt.',
      );
    } else {
      // We are creating a new `AdjacencyList` from scratch.
      let {nodeCapacity = 128, edgeCapacity = 256} = opts ?? {};

      // $FlowFixMe[incompatible-call]
      nodes = new Uint32Array(
        new SharedArrayBuffer(
          getNodesLength(nodeCapacity) * Uint32Array.BYTES_PER_ELEMENT,
        ),
      );
      nodes[CAPACITY] = nodeCapacity;

      // $FlowFixMe[incompatible-call]
      edges = new Uint32Array(
        new SharedArrayBuffer(
          getEdgesLength(edgeCapacity) * Uint32Array.BYTES_PER_ELEMENT,
        ),
      );
      edges[CAPACITY] = edgeCapacity;
    }

    this.#nodes = nodes;
    this.#edges = edges;
    this.#previousIn = new Map();
    this.#previousOut = new Map();
  }

  /**
   * Create a new `AdjacencyList` from the given options.
   */
  static deserialize(
    opts: SerializedAdjacencyList<TEdgeType>,
  ): AdjacencyList<TEdgeType> {
    return new AdjacencyList(opts);
  }

  /**
   * Returns a JSON-serializable object of the nodes and edges in the graph.
   */
  serialize(): SerializedAdjacencyList<TEdgeType> {
    return {
      nodes: this.#nodes,
      edges: this.#edges,
    };
  }

  get addressableLimit(): number {
    return getAddressableLimit(this.#edges[CAPACITY]);
  }

  get stats(): {|
    /** The number of nodes in the graph. */
    nodes: number,
    /** The maximum number of nodes the graph can contain. */
    nodeCapacity: number,
    /** The current load on the nodes array. */
    nodeLoad: string,
    /** The number of edges in the graph. */
    edges: number,
    /** The number of edges deleted from the graph. */
    deleted: number,
    /** The maximum number of edges the graph can contain. */
    edgeCapacity: number,
    /** The current load on the edges array. */
    edgeLoad: string,
    /** The total number of edge hash collisions. */
    collisions: number,
    /** The number of collisions for the most common hash. */
    maxCollisions: number,
    /** The average number of collisions per hash. */
    avgCollisions: number,
    /** The likelihood of uniform distribution. ~1.0 indicates certainty. */
    uniformity: number,
  |} {
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

    let numNodes = this.#nodes[COUNT];
    let nodeCapacity = this.#nodes[CAPACITY];

    let numEdges = this.#edges[COUNT];
    let numDeletedEdges = this.#edges[DELETES];
    let edgeCapacity = this.#edges[CAPACITY];

    let uniformity =
      distribution /
      ((numEdges / (2 * edgeCapacity)) * (numEdges + 2 * edgeCapacity - 1));

    return {
      nodes: numNodes,
      edges: numEdges,
      deleted: numDeletedEdges,
      collisions,
      nodeCapacity,
      nodeLoad: `${Math.round((numNodes / nodeCapacity) * 100)}%`,
      edgeCapacity: edgeCapacity * 2,
      edgeLoad: `${Math.round((numEdges / (edgeCapacity * 2)) * 100)}%`,
      maxCollisions,
      avgCollisions: Math.round((collisions / buckets.size) * 100) / 100 || 0,
      uniformity: Math.round(uniformity * 100) / 100 || 0,
    };
  }

  /** Iterate over node ids in the `AdjacencyList`. */
  *iterateNodes(max: number = this.#nodes[COUNT]): Iterator<NodeId> {
    let count = 0;
    let len = this.#nodes.length;
    for (let i = NODES_HEADER_SIZE; i < len; i += NODE_SIZE) {
      if (count++ >= max) break;
      yield nodeAt(i);
    }
  }

  /** Iterate over outgoing edge hashes from the given `nodeId` the `AdjacencyList`. */
  *iterateOutgoingEdges(nodeId: NodeId): Iterator<EdgeIndex> {
    let edge = this.getEdge(nodeId, FIRST_OUT);
    while (edge) {
      yield edge;
      edge = this.getLinkedEdge(edge, NEXT_OUT);
    }
  }

  /** Iterate over incoming edge hashes to the given `nodeId` the `AdjacencyList`. */
  *iterateIncomingEdges(nodeId: NodeId): Iterator<EdgeIndex> {
    let edge = this.getEdge(nodeId, FIRST_IN);
    while (edge) {
      yield edge;
      edge = this.getLinkedEdge(edge, NEXT_IN);
    }
  }

  /** Check that the edge exists in the `AdjacencyList`. */
  edgeExists(edge: EdgeIndex): boolean {
    let type = (this.#edges[edge + TYPE]: any);
    return Boolean(type) && !isDeleted(type);
  }

  /** Gets the original hash of the given edge */
  getHash(edge: EdgeIndex): EdgeHash {
    return this.hash(
      this.getFromNode(edge),
      this.getToNode(edge),
      this.getEdgeType(edge),
    );
  }

  /** Get the type of the given edge. */
  getEdgeType(edge: EdgeIndex): TEdgeType {
    return (this.#edges[edge + TYPE]: any);
  }

  /** Get the node id the given edge originates from */
  getFromNode(edge: EdgeIndex): NodeId {
    return toNodeId(this.#edges[edge + FROM]);
  }

  /** Get the node id the given edge terminates to. */
  getToNode(edge: EdgeIndex): NodeId {
    return toNodeId(this.#edges[edge + TO]);
  }

  /**
   * Resize the internal nodes array.
   *
   * This is used in `addNode` when the `numNodes` meets or exceeds
   * the allocated size of the `nodes` array.
   */
  resizeNodes(size: number) {
    let nodes = this.#nodes;
    // Allocate the required space for a `nodes` array of the given `size`.
    // $FlowFixMe[incompatible-call]
    this.#nodes = new Uint32Array(
      new SharedArrayBuffer(
        getNodesLength(size) * Uint32Array.BYTES_PER_ELEMENT,
      ),
    );
    // Copy the existing nodes into the new array.
    this.#nodes.set(nodes);
    this.#nodes[CAPACITY] = size;
  }

  /**
   * Resize the internal edges array.
   *
   * This is used in `addEdge` when the `numEdges` meets or exceeds
   * the allocated size of the `edges` array.
   */
  resizeEdges(size: number) {
    // Allocate the required space for new `nodes` and `edges` arrays.
    let copy = new AdjacencyList({
      nodeCapacity: this.#nodes[CAPACITY],
      edgeCapacity: size,
    });
    copy.#nodes[COUNT] = this.#nodes[COUNT];

    // Copy the existing edges into the new array.
    let max = this.#nodes[COUNT];
    let count = 0;
    let len = this.#nodes.length;
    for (let i = NODES_HEADER_SIZE; i < len; i += NODE_SIZE) {
      if (count++ >= max) break;
      let edge = this.getEdge(nodeAt(i), FIRST_OUT);
      while (edge) {
        copy.addEdge(
          this.getFromNode(edge),
          this.getToNode(edge),
          this.getEdgeType(edge),
        );
        edge = this.getLinkedEdge(edge, NEXT_OUT);
      }
    }

    // We expect to preserve the same number of edges.
    assert(
      this.#edges[COUNT] === copy.#edges[COUNT],
      `Edge mismatch! ${this.#edges[COUNT]} does not match ${
        copy.#edges[COUNT]
      }.`,
    );

    // Finally, copy the new data arrays over to this graph.
    this.#nodes = copy.#nodes;
    this.#edges = copy.#edges;
    this.#previousIn = copy.#previousIn;
    this.#previousOut = copy.#previousOut;
  }

  /** Get the first or last edge to or from the given node. */
  getEdge(
    node: NodeId,
    direction:
      | typeof FIRST_IN
      | typeof FIRST_OUT
      | typeof LAST_IN
      | typeof LAST_OUT,
  ): EdgeIndex | null {
    let edge = this.#nodes[indexOfNode(node) + direction];
    return edge ? edge : null;
  }

  /** Set the first or last edge to or from the given node. */
  setEdge(
    node: NodeId,
    edge: EdgeIndex | null,
    direction:
      | typeof FIRST_IN
      | typeof FIRST_OUT
      | typeof LAST_IN
      | typeof LAST_OUT,
  ) {
    this.#nodes[indexOfNode(node) + direction] = edge ?? 0;
  }

  linkEdge(
    prev: EdgeHash | EdgeIndex,
    edge: EdgeIndex,
    direction?: typeof NEXT_HASH | typeof NEXT_IN | typeof NEXT_OUT,
  ): void {
    if (direction) {
      this.#edges[prev + direction] = edge;
      if (direction === NEXT_IN) this.#previousIn.set(edge, prev);
      else if (direction === NEXT_OUT) this.#previousOut.set(edge, prev);
    } else {
      this.#edges[hashToIndex(prev)] = edge;
    }
  }

  unlinkEdge(
    prev: EdgeHash | EdgeIndex,
    edge?: EdgeIndex,
    direction?: typeof NEXT_HASH | typeof NEXT_IN | typeof NEXT_OUT,
  ): void {
    if (direction && edge) {
      this.#edges[prev + direction] = 0;
      if (direction === NEXT_IN) this.#previousIn.delete(edge);
      else if (direction === NEXT_OUT) this.#previousOut.delete(edge);
    } else {
      this.#edges[hashToIndex(prev)] = 0;
    }
  }

  /** Get the edge this `edge` links to in the given direction. */
  getLinkedEdge(
    prev: EdgeHash | EdgeIndex | null,
    direction?: typeof NEXT_HASH | typeof NEXT_IN | typeof NEXT_OUT,
  ): EdgeIndex | null {
    if (prev === null) return null;
    if (direction) {
      return this.#edges[prev + direction] || null;
    } else {
      return this.#edges[hashToIndex(prev)] || null;
    }
  }

  /** Find the edge linked to the given `edge`. */
  findEdgeBefore(
    edge: EdgeIndex,
    direction: typeof NEXT_HASH | typeof NEXT_IN | typeof NEXT_OUT,
  ): EdgeIndex | null {
    if (direction === NEXT_IN) {
      let prevIn = this.#previousIn.get(edge);
      if (prevIn) return prevIn;
    } else if (direction === NEXT_OUT) {
      let prevOut = this.#previousOut.get(edge);
      if (prevOut) return prevOut;
    }

    let candidate =
      direction === NEXT_HASH
        ? this.getLinkedEdge(this.getHash(edge))
        : direction === NEXT_IN
        ? this.getEdge(this.getToNode(edge), FIRST_IN)
        : this.getEdge(this.getFromNode(edge), FIRST_OUT);

    if (edge === candidate) return null;

    while (candidate) {
      let next = this.getLinkedEdge(candidate, direction);
      if (next === edge) {
        if (direction === NEXT_IN) this.#previousIn.set(edge, candidate);
        else if (direction === NEXT_OUT) this.#previousOut.set(edge, candidate);
        return candidate;
      }
      candidate = next;
    }

    return null;
  }

  /**
   * Adds a node to the graph.
   *
   * Returns the id of the added node.
   */
  addNode(): NodeId {
    let id = this.#nodes[COUNT];
    this.#nodes[COUNT]++;
    // If we're in danger of overflowing the `nodes` array, resize it.
    if (this.#nodes[COUNT] >= this.#nodes[CAPACITY]) {
      // The size of `nodes` doubles every time we reach the current capacity.
      // This means in the worst case, we will have `O(n - 1)` _extra_
      // space allocated where `n` is a number nodes that is 1 more
      // than the previous capacity.
      this.resizeNodes(increaseNodeCapacity(this.#nodes[CAPACITY]));
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
    if (fromNodeId(from) < 0 || fromNodeId(from) >= this.#nodes[COUNT]) {
      throw new Error(`Unknown node ${String(from)}`);
    }
    if (fromNodeId(to) < 0 || fromNodeId(to) >= this.#nodes[COUNT]) {
      throw new Error(`Unknown node ${String(to)}`);
    }
    if (type <= 0) throw new Error(`Unsupported edge type ${0}`);

    // The edge is already in the graph; do nothing.
    if (this.hasEdge(from, to, type)) return false;

    let count = this.#edges[COUNT] + this.#edges[DELETES] + 1;
    // If we're in danger of overflowing the `edges` array, resize it.
    if (count / (this.#edges[CAPACITY] * BUCKET_SIZE) > LOAD_FACTOR) {
      // The size of `edges` doubles every time we reach the current capacity.
      // This means in the worst case, we will have `O(n - 1)` _extra_
      // space allocated where `n` is a number edges that is 1 more
      // than the previous capacity.
      this.resizeEdges(increaseEdgeCapacity(this.#edges[CAPACITY]));
    }

    // Use the next available index as our new edge index.
    let edge = this.getNextIndex();

    // Add our new edge to its hash bucket.
    let hash = this.hash(from, to, type);
    let prev = this.getLinkedEdge(hash);
    if (prev) {
      let next = this.getLinkedEdge(prev, NEXT_HASH);
      while (next) {
        prev = next;
        next = this.getLinkedEdge(next, NEXT_HASH);
      }

      this.linkEdge(prev, edge, NEXT_HASH);
    } else {
      // This is the first edge in the bucket!
      this.linkEdge(hash, edge);
    }

    this.#edges[edge + TYPE] = type;
    this.#edges[edge + FROM] = fromNodeId(from);
    this.#edges[edge + TO] = fromNodeId(to);

    let firstIncoming = this.getEdge(to, FIRST_IN);
    let lastIncoming = this.getEdge(to, LAST_IN);
    let firstOutgoing = this.getEdge(from, FIRST_OUT);
    let lastOutgoing = this.getEdge(from, LAST_OUT);

    // If the `to` node has incoming edges, link the last edge to this one.
    if (lastIncoming) this.linkEdge(lastIncoming, edge, NEXT_IN);
    // Set this edge as the last incoming edge to the `to` node.
    this.setEdge(to, edge, LAST_IN);
    // If the `to` node has no incoming edges, set this edge as the first one.
    if (!firstIncoming) this.setEdge(to, edge, FIRST_IN);

    // If the `from` node has outgoing edges, link the last edge to this one.
    if (lastOutgoing) this.linkEdge(lastOutgoing, edge, NEXT_OUT);
    // Set this edge as the last outgoing edge from the `from` node.
    this.setEdge(from, edge, LAST_OUT);
    // If the `from` node has no outgoing edges, set this edge as the first one.
    if (!firstOutgoing) this.setEdge(from, edge, FIRST_OUT);

    this.#edges[COUNT]++;

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
  ): EdgeIndex {
    let hash = this.hash(from, to, type);
    let edge = this.getLinkedEdge(hash);
    while (edge) {
      if (
        this.getFromNode(edge) === from &&
        this.getToNode(edge) === to &&
        this.getEdgeType(edge) === type
      ) {
        return edge;
      }
      edge = this.getLinkedEdge(edge, NEXT_HASH);
    }
    return -1;
  }

  /** Get the next available index in the edges array.  */
  getNextIndex(): number {
    let offset = (this.#edges[COUNT] + this.#edges[DELETES]) * EDGE_SIZE;
    let index = this.addressableLimit + offset;
    return index;
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
    let hash = this.hash(from, to, type);
    let edge = this.getLinkedEdge(hash);
    while (edge && this.edgeExists(edge)) {
      if (
        this.getFromNode(edge) === from &&
        this.getToNode(edge) === to &&
        this.getEdgeType(edge) === type
      ) {
        break;
      }
      edge = this.getLinkedEdge(edge, NEXT_HASH);
    }

    // The edge is not in the graph; do nothing.
    if (!edge) return;

    /** The first incoming edge to the removed edge's terminus. */
    let firstIn = this.getEdge(to, FIRST_IN);
    /** The last incoming edge to the removed edge's terminus. */
    let lastIn = this.getEdge(to, LAST_IN);
    /** The next incoming edge after the removed edge. */
    let nextIn = this.getLinkedEdge(edge, NEXT_IN);
    /** The previous incoming edge before the removed edge. */
    let previousIn = this.findEdgeBefore(edge, NEXT_IN);
    /** The first outgoing edge from the removed edge's origin. */
    let firstOut = this.getEdge(from, FIRST_OUT);
    /** The last outgoing edge from the removed edge's origin. */
    let lastOut = this.getEdge(from, LAST_OUT);
    /** The next outgoing edge after the removed edge. */
    let nextOut = this.getLinkedEdge(edge, NEXT_OUT);
    /** The previous outgoing edge before the removed edge. */
    let previousOut = this.findEdgeBefore(edge, NEXT_OUT);
    /** The next edge in the bucket after the removed edge. */
    let nextEdge = this.getLinkedEdge(edge, NEXT_HASH);
    /** The previous edge in the bucket before the removed edge. */
    let prevEdge = this.findEdgeBefore(edge, NEXT_HASH);

    // Splice the removed edge out of the linked list of edges in the bucket.
    if (prevEdge && nextEdge) this.linkEdge(prevEdge, nextEdge, NEXT_HASH);
    else if (prevEdge) this.unlinkEdge(prevEdge, edge, NEXT_HASH);
    else if (nextEdge) this.linkEdge(hash, nextEdge);
    else this.unlinkEdge(hash);

    // Splice the removed edge out of the linked list of incoming edges.
    if (previousIn && nextIn) this.linkEdge(previousIn, nextIn, NEXT_IN);
    else if (previousIn) this.unlinkEdge(previousIn, edge, NEXT_IN);

    // Splice the removed edge out of the linked list of outgoing edges.
    if (previousOut && nextOut) this.linkEdge(previousOut, nextOut, NEXT_OUT);
    else if (previousOut) this.unlinkEdge(previousOut, edge, NEXT_OUT);

    // Update the terminating node's first and last incoming edges.
    if (firstIn === edge) this.setEdge(to, nextIn, FIRST_IN);
    if (lastIn === edge) this.setEdge(to, previousIn, LAST_IN);

    // Update the originating node's first and last outgoing edges.
    if (firstOut === edge) this.setEdge(from, nextOut, FIRST_OUT);
    if (lastOut === edge) this.setEdge(from, previousOut, LAST_OUT);

    // Mark this slot as DELETED.
    // We do this so that clustered edges can still be found
    // by scanning forward in the array from the first index for
    // the cluster.
    this.#edges[edge + TYPE] = DELETED;
    this.#edges[edge + FROM] = 0;
    this.#edges[edge + TO] = 0;
    this.#edges[edge + NEXT_HASH] = 0;
    this.#edges[edge + NEXT_IN] = 0;
    this.#edges[edge + NEXT_OUT] = 0;

    this.#edges[COUNT]--;
    this.#edges[DELETES]++;

    // The percentage of utilization of the total capacity of `edges`.
    // If we've dropped below the unload threshold, resize the array down.
    if (
      this.#edges[CAPACITY] > MIN_CAPACITY &&
      this.#edges[COUNT] / (this.#edges[CAPACITY] * BUCKET_SIZE) < UNLOAD_FACTOR
    ) {
      this.resizeEdges(decreaseEdgeCapacity(this.#edges[CAPACITY]));
    }
  }

  hasInboundEdges(to: NodeId): boolean {
    return Boolean(this.getEdge(to, FIRST_IN));
  }

  *getInboundEdgesByType(
    to: NodeId,
  ): Generator<{|type: TEdgeType, from: NodeId|}, void, void> {
    let edge = this.getEdge(to, FIRST_IN);
    while (edge) {
      let from = this.getFromNode(edge);
      let type = this.getEdgeType(edge);
      yield {type: (type: any), from};
      if (edge != null) {
        edge = this.#edges[edge + NEXT_IN];
      }
    }
  }

  *getOutboundEdgesByType(
    from: NodeId,
  ): Generator<{|type: TEdgeType, to: NodeId|}, void, void> {
    let edge = this.getEdge(from, FIRST_OUT);
    while (edge) {
      let to = this.getToNode(edge);
      let type = this.getEdgeType(edge);
      yield {type: (type: any), to};
      if (edge != null) {
        edge = this.#edges[edge + NEXT_OUT];
      }
    }
  }

  /**
   * Get the list of nodes connected from this node in reverse order.
   */
  *getNodesConnectedFromReverse(
    from: NodeId,
    type:
      | AllEdgeTypes
      | TEdgeType
      | NullEdgeType
      | Array<TEdgeType | NullEdgeType> = 1,
  ): Generator<NodeId, void, void> {
    let edge = this.getEdge(from, LAST_OUT);
    while (edge) {
      if (Array.isArray(type)) {
        if (type.includes(this.getEdgeType(edge))) {
          yield this.getToNode(edge);
        }
      } else if (this.getEdgeType(edge) === type || type === ALL_EDGE_TYPES) {
        yield this.getToNode(edge);
      }
      if (edge != null) {
        edge = this.findEdgeBefore(edge, NEXT_OUT);
      }
    }
  }

  get edges(): Uint32Array {
    return this.#edges;
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
  ): Generator<NodeId, void, void> {
    let edge = this.getEdge(from, FIRST_OUT);
    while (edge) {
      if (Array.isArray(type)) {
        if (type.includes(this.getEdgeType(edge))) {
          yield this.getToNode(edge);
        }
      } else if (this.getEdgeType(edge) === type || type === ALL_EDGE_TYPES) {
        yield this.getToNode(edge);
      }
      if (edge != null) {
        edge = this.#edges[edge + NEXT_OUT];
      }
    }
  }

  *getNodesConnectedTo(
    to: NodeId,
    type:
      | AllEdgeTypes
      | TEdgeType
      | NullEdgeType
      | Array<TEdgeType | NullEdgeType> = 1,
    calledFromGetChildren: boolean = false,
  ): Generator<NodeId, void, void> {
    let edge = this.getEdge(to, FIRST_IN);
    while (edge) {
      if (Array.isArray(type)) {
        if (type.includes(this.getEdgeType(edge))) {
          yield this.getFromNode(edge);
        }
      } else if (this.getEdgeType(edge) === type || type === ALL_EDGE_TYPES) {
        yield this.getFromNode(edge);
      }
      if (edge != null) {
        edge = this.#edges[edge + NEXT_IN];
      }
    }
  }

  /**
   * Create a hash of the edge connecting the `from` and `to` nodes.
   *
   * This hash is used to index the edge in the `edges` array.
   *
   */
  hash(from: NodeId, to: NodeId, type: TEdgeType | NullEdgeType): EdgeHash {
    // A crude multiplicative hash, in 3 steps:
    // 1. Serialize the args into an integer that reflects the argument order,
    // shifting the magnitude of each argument by the sum
    // of the significant digits of the following arguments,
    // .e.g., `hash(10, 24, 4) => 10244`.
    // $FlowFixMe[unsafe-addition]
    // $FlowFixMe[incompatible-type]
    let hash = '' + from + to + type - 0;
    // 2. Mix the upper bits of the integer into the lower bits.
    // We do this to increase the likelihood that a change to any
    // bit of the input will vary the output widely.
    hash = hash32shift(hash);
    // 3. Map the hash to a value modulo the edge capacity.
    hash %= this.#edges[CAPACITY];
    return hash;
  }
}
