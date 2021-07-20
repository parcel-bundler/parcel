// @flow
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
 * The fourth 4 bytes are the hash of the 'to' node's next incoming edge.
 * The fifth 4 bytes are the hash of the 'from' node's next outgoing edge.
 *
 * struct Edge {
 *   int type;
 *   int from;
 *   int to;
 *   int nextIn;
 *   int nextOut;
 * }
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │                           EDGE_SIZE                            │
 * ├────────────┬────────────┬────────────┬────────────┬────────────┤
 * │    TYPE    │    FROM    │     TO     │  NEXT_IN   │  NEXT_OUT  │
 * └────────────┴────────────┴────────────┴────────────┴────────────┘
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
export const EDGE_SIZE = 5;

/** The offset from an edge index at which the edge type is stored. */
const TYPE: 0 = 0;
/** The offset from an edge index at which the 'from' node id is stored. */
const FROM: 1 = 1;
/** The offset from an edge index at which the 'to' node id is stored. */
const TO: 2 = 2;
/**
 * The offset from an edge index at which the hash
 * of the 'to' node's next incoming edge is stored.
 */
const NEXT_IN: 3 = 3;
/**
 * The offset from an edge index at which the hash
 * of the 'from' node's next outgoing edge is stored.
 */
const NEXT_OUT: 4 = 4;

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

export type AdjacencyListOptions<TEdgeType> = {|
  edgeCapacity?: number,
  nodeCapacity?: number,
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

/** Create mappings from => type => to and vice versa. */
function buildTypeMaps<TEdgeType: number = 1>(
  graph: AdjacencyList<TEdgeType>,
): {|
  from: DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>,
  to: DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>,
|} {
  let from = new DefaultMap(() => new DefaultMap(() => new Set()));
  let to = new DefaultMap(() => new DefaultMap(() => new Set()));
  for (let node of graph.iterateNodes()) {
    for (let edge of graph.iterateOutgoingEdges(node)) {
      from
        .get(node)
        .get(graph.getEdgeType(edge))
        .add(graph.getToNode(edge));
    }
    for (let edge of graph.iterateIncomingEdges(node)) {
      to.get(node)
        .get(graph.getEdgeType(edge))
        .add(graph.getFromNode(edge));
    }
  }
  return {from, to};
}

const readonlyDescriptor: PropertyDescriptor<(...args: any[]) => void> = {
  enumerable: true,
  configurable: false,
  writable: false,
  value: () => {
    throw new Error('Deserialized AdjacencyList is readonly!');
  },
};

export default class AdjacencyList<TEdgeType: number = 1> {
  /** The number of nodes that can fit in the nodes array. */
  #nodeCapacity: number;
  /** The number of edges that can fit in the edges array. */
  #edgeCapacity: number;
  /** An array of nodes, with each node occupying `NODE_SIZE` adjacent indices. */
  #nodes: Uint32Array;
  /** An array of edges, with each edge occupying `EDGE_SIZE` adjacent indices. */
  #edges: Uint32Array;
  /** The count of the number of nodes in the graph. */
  #numNodes: number;
  /** The count of the number of edges in the graph. */
  #numEdges: number;
  /** A map of edges to the previous incoming edge. */
  #previousIn: Map<EdgeHash, EdgeHash | null>;
  /** A map of edges to the previous outgoing edge. */
  #previousOut: Map<EdgeHash, EdgeHash | null>;
  #typeMaps: ?{|
    /** A map of node ids from => through types => to node ids. */
    from: DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>,
    /** A map of node ids to => through types => from node ids. */
    to: DefaultMap<NodeId, DefaultMap<number, Set<NodeId>>>,
  |};

  constructor(
    opts?: SerializedAdjacencyList<TEdgeType> | AdjacencyListOptions<TEdgeType>,
  ) {
    let {
      nodeCapacity = 128,
      edgeCapacity = 256,
      numNodes = 0,
      numEdges = 0,
      // $FlowFixMe[incompatible-call]
      nodes = new Uint32Array(
        new SharedArrayBuffer(
          nodeCapacity * NODE_SIZE * Uint32Array.BYTES_PER_ELEMENT,
        ),
      ),
      // $FlowFixMe[incompatible-call]
      edges = new Uint32Array(
        new SharedArrayBuffer(
          edgeCapacity * EDGE_SIZE * Uint32Array.BYTES_PER_ELEMENT,
        ),
      ),
    } = opts ?? {};

    this.#nodeCapacity = nodeCapacity;
    this.#edgeCapacity = edgeCapacity;
    this.#numNodes = numNodes;
    this.#numEdges = numEdges;
    this.#nodes = nodes;
    this.#edges = edges;
    this.#previousIn = new Map();
    this.#previousOut = new Map();
  }

  /**
   * Create a new `AdjacencyList` from the given options.
   *
   * Note that the returned AdjacencyList` will be readonly,
   * as it simply provides a view onto the shared memory addresses
   * of the serialized data.
   *
   * If a mutable `AdjacencyList` is required,
   * use `AdjacencyList.deserialize(opts, true)` instead.
   */
  static deserialize(
    opts: SerializedAdjacencyList<TEdgeType>,
    mutable?: boolean,
  ): AdjacencyList<TEdgeType> {
    let res = new AdjacencyList(opts);
    if (mutable) return res.clone();
    // Make the new instance readonly.
    // We do this because deserialization happens from a shared buffer,
    // so mutation would be a bad idea.
    // $FlowFixMe[cannot-write]
    Object.defineProperties(res, {
      addEdge: readonlyDescriptor,
      addNode: readonlyDescriptor,
      linkEdge: readonlyDescriptor,
      resizeNodes: readonlyDescriptor,
      resizeEdges: readonlyDescriptor,
      removeEdge: readonlyDescriptor,
      setEdge: readonlyDescriptor,
      unlinkEdge: readonlyDescriptor,
    });
    return res;
  }

  /**
   * Returns a JSON-serializable object of the nodes and edges in the graph.
   */
  serialize(): SerializedAdjacencyList<TEdgeType> {
    return {
      nodes: this.#nodes,
      edges: this.#edges,
      numNodes: this.#numNodes,
      numEdges: this.#numEdges,
      edgeCapacity: this.#edgeCapacity,
      nodeCapacity: this.#nodeCapacity,
    };
  }

  /**
   * Returns a clone of this graph.
   *
   * This differs from `AdjacenyList.deserialize()`
   * in that the clone copies the underlying data to new memory addresses.
   */
  clone(): AdjacencyList<TEdgeType> {
    // $FlowFixMe[incompatible-call]
    let nodes = new Uint32Array(
      new SharedArrayBuffer(
        this.#nodeCapacity * NODE_SIZE * Uint32Array.BYTES_PER_ELEMENT,
      ),
    );
    nodes.set(this.#nodes);

    // $FlowFixMe[incompatible-call]
    let edges = new Uint32Array(
      new SharedArrayBuffer(
        this.#edgeCapacity * EDGE_SIZE * Uint32Array.BYTES_PER_ELEMENT,
      ),
    );
    edges.set(this.#edges);

    return new AdjacencyList({
      nodeCapacity: this.#nodeCapacity,
      edgeCapacity: this.#edgeCapacity,
      numNodes: this.#numNodes,
      numEdges: this.#numEdges,
      nodes,
      edges,
    });
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
      ((this.#numEdges / (2 * this.#edgeCapacity)) *
        (this.#numEdges + 2 * this.#edgeCapacity - 1));

    return {
      nodes: this.#numNodes,
      edges: this.#numEdges,
      nodeCapacity: this.#nodeCapacity,
      nodeLoad: this.#numNodes / this.#nodeCapacity,
      edgeCapacity: this.#edgeCapacity,
      edgeLoad: this.#numEdges / this.#edgeCapacity,
      collisions,
      maxCollisions,
      uniformity,
    };
  }

  /** Iterate over node ids in the `AdjacencyList`. */
  *iterateNodes(max: number = this.#numNodes): Iterator<NodeId> {
    let count = 0;
    for (let i = 0; i < this.#nodes.length; i += NODE_SIZE) {
      if (count++ >= max) break;
      yield nodeAt(i);
    }
  }

  /** Iterate over outgoing edge hashes from the given `nodeId` the `AdjacencyList`. */
  *iterateOutgoingEdges(nodeId: NodeId): Iterator<EdgeHash> {
    let hash = this.getEdge(FIRST_OUT, nodeId);
    while (hash) {
      yield hash;
      hash = this.getLinkedEdge(NEXT_OUT, hash);
    }
  }

  /** Iterate over incoming edge hashes to the given `nodeId` the `AdjacencyList`. */
  *iterateIncomingEdges(nodeId: NodeId): Iterator<EdgeHash> {
    let hash = this.getEdge(FIRST_IN, nodeId);
    while (hash) {
      yield hash;
      hash = this.getLinkedEdge(NEXT_IN, hash);
    }
  }

  /** Check that the edge exists in the `AdjacencyList`. */
  edgeExists(edge: EdgeHash): boolean {
    let type = (this.#edges[hashToIndex(edge) + TYPE]: any);
    return Boolean(type) && !isDeleted(type);
  }

  /** Get the type of the given edge. */
  getEdgeType(edge: EdgeHash): TEdgeType {
    assert(this.edgeExists(edge));
    return (this.#edges[hashToIndex(edge) + TYPE]: any);
  }

  /** Get the node id the given edge originates from */
  getFromNode(edge: EdgeHash): NodeId {
    assert(this.edgeExists(edge));
    return toNodeId(this.#edges[hashToIndex(edge) + FROM]);
  }

  /** Get the node id the given edge terminates to. */
  getToNode(edge: EdgeHash): NodeId {
    assert(this.edgeExists(edge));
    return toNodeId(this.#edges[hashToIndex(edge) + TO]);
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
      new SharedArrayBuffer(size * NODE_SIZE * Uint32Array.BYTES_PER_ELEMENT),
    );
    // Copy the existing nodes into the new array.
    this.#nodes.set(nodes);
    this.#nodeCapacity = size;
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
      nodeCapacity: this.#nodeCapacity,
      edgeCapacity: size,
    });
    copy.#numNodes = this.#numNodes;

    // For each node in the graph, copy the existing edges into the new array.
    for (let from of this.iterateNodes()) {
      for (let edge of this.iterateOutgoingEdges(from)) {
        copy.addEdge(from, this.getToNode(edge), this.getEdgeType(edge));
      }
    }

    // Finally, copy the new data arrays over to this graph.
    this.#nodes = copy.#nodes;
    this.#edges = copy.#edges;
    this.#edgeCapacity = size;
    this.#typeMaps = copy.#typeMaps;
    this.#previousIn = copy.#previousIn;
    this.#previousOut = copy.#previousOut;
  }

  /** Get the first or last edge to or from the given node. */
  getEdge(
    direction:
      | typeof FIRST_IN
      | typeof FIRST_OUT
      | typeof LAST_IN
      | typeof LAST_OUT,
    node: NodeId,
  ): EdgeHash | null {
    let hash = this.#nodes[indexOfNode(node) + direction];
    return hash ? hash : null;
  }

  /** Set the first or last edge to or from the given node. */
  setEdge(
    direction:
      | typeof FIRST_IN
      | typeof FIRST_OUT
      | typeof LAST_IN
      | typeof LAST_OUT,
    node: NodeId,
    edge: EdgeHash | null,
  ) {
    let hash = edge ?? 0;
    this.#nodes[indexOfNode(node) + direction] = hash;
  }

  /** Insert the given `edge` after the `previous` edge.  */
  linkEdge(
    direction: typeof NEXT_IN | typeof NEXT_OUT,
    prev: EdgeHash,
    edge: EdgeHash,
  ): void {
    this.#edges[hashToIndex(prev) + direction] = edge;
    if (direction === NEXT_IN) {
      this.#previousIn.set(edge, prev);
    } else {
      this.#previousOut.set(edge, prev);
    }
  }

  /** Remove the given `edge` between `previous` and `next` edges. */
  unlinkEdge(
    direction: typeof NEXT_IN | typeof NEXT_OUT,
    prev: EdgeHash | null,
    edge: EdgeHash,
    next: EdgeHash | null,
  ): void {
    if (prev) this.#edges[hashToIndex(prev) + direction] = next ?? 0;
    this.#edges[hashToIndex(edge) + direction] = 0;

    if (direction === NEXT_IN) {
      this.#previousIn.delete(edge);
      if (next) this.#previousIn.set(next, prev);
    } else {
      this.#previousOut.delete(edge);
      if (next) this.#previousOut.set(next, prev);
    }
  }

  /** Get the edge linked to this edge in the given direction. */
  getLinkedEdge(
    direction: typeof NEXT_IN | typeof NEXT_OUT,
    edge: EdgeHash | null,
  ): EdgeHash | null {
    if (edge === null) return null;
    return this.#edges[hashToIndex(edge) + direction];
  }

  /** Find the edge linked to the given `edge`. */
  findEdgeBefore(
    direction: typeof NEXT_IN | typeof NEXT_OUT,
    edge: EdgeHash,
  ): EdgeHash | null {
    let cached =
      direction === NEXT_IN
        ? this.#previousIn.get(edge)
        : this.#previousOut.get(edge);

    if (cached || cached === null) return cached;

    let node =
      direction === NEXT_IN ? this.getToNode(edge) : this.getFromNode(edge);

    let candidate =
      direction === NEXT_IN
        ? this.getEdge(FIRST_IN, node)
        : this.getEdge(FIRST_OUT, node);

    if (edge === candidate) {
      candidate = null;
    } else {
      while (candidate) {
        if (candidate) {
          let next =
            direction === NEXT_IN
              ? this.getLinkedEdge(NEXT_IN, candidate)
              : this.getLinkedEdge(NEXT_OUT, candidate);
          if (next === edge) return candidate;
          candidate = next;
        }
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
    let id = this.#numNodes;
    this.#numNodes++;
    // If we're in danger of overflowing the `nodes` array, resize it.
    if (this.#numNodes >= this.#nodeCapacity) {
      // The size of `nodes` doubles every time we reach the current capacity.
      // This means in the worst case, we will have `O(n - 1)` _extra_
      // space allocated where `n` is a number nodes that is 1 more
      // than the previous capacity.
      this.resizeNodes(this.#nodeCapacity * 2);
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
    if (fromNodeId(from) < 0 || fromNodeId(from) >= this.#numNodes) {
      throw new Error(`Unknown node ${String(from)}`);
    }
    if (fromNodeId(to) < 0 || fromNodeId(to) >= this.#numNodes) {
      throw new Error(`Unknown node ${String(to)}`);
    }
    if (type <= 0) throw new Error(`Unsupported edge type ${0}`);

    // The percentage of utilization of the total capacity of `edges`.
    let load = (this.#numEdges + 1) / this.#edgeCapacity;
    // If we're in danger of overflowing the `edges` array, resize it.
    if (load > 0.7) {
      // The size of `edges` doubles every time we reach the current capacity.
      // This means in the worst case, we will have `O(n - 1)` _extra_
      // space allocated where `n` is a number edges that is 1 more
      // than the previous capacity.
      this.resizeEdges(this.#edgeCapacity * 2);
    }

    // We use the hash of the edge as the index for the edge.
    let index = this.indexFor(from, to, type);

    if (index === -1) {
      // The edge is already in the graph; do nothing.
      return false;
    }

    this.#numEdges++;

    this.#edges[index + TYPE] = type;
    this.#edges[index + FROM] = fromNodeId(from);
    this.#edges[index + TO] = fromNodeId(to);

    let edge = indexToHash(index);
    let firstIncoming = this.getEdge(FIRST_IN, to);
    let lastIncoming = this.getEdge(LAST_IN, to);
    let firstOutgoing = this.getEdge(FIRST_OUT, from);
    let lastOutgoing = this.getEdge(LAST_OUT, from);

    // If the `to` node has incoming edges, link the last edge to this one.
    // from: lastIncoming => null
    // to: lastIncoming => edge => null
    if (lastIncoming) this.linkEdge(NEXT_IN, lastIncoming, edge);
    // Set this edge as the last incoming edge to the `to` node.
    this.setEdge(LAST_IN, to, edge);
    // If the `to` node has no incoming edges, set this edge as the first one.
    if (!firstIncoming) this.setEdge(FIRST_IN, to, edge);

    // If the `from` node has outgoing edges, link the last edge to this one.
    // from: lastOutgoing => null
    // to: lastOutgoing => edge => null
    if (lastOutgoing) this.linkEdge(NEXT_OUT, lastOutgoing, edge);
    // Set this edge as the last outgoing edge from the `from` node.
    this.setEdge(LAST_OUT, from, edge);
    // If the `from` node has no outgoing edges, set this edge as the first one.
    if (!firstOutgoing) this.setEdge(FIRST_OUT, from, edge);

    this.#typeMaps?.from
      .get(from)
      .get(type)
      .add(to);

    this.#typeMaps?.to
      .get(to)
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
    let size = this.#edges.length;
    // Since it is possible for multiple edges to have the same hash,
    // we check that the edge at the index matching the hash is actually
    // the edge we're looking for. If it's not, we scan forward in the
    // edges array, assuming that the the edge we're looking for is close by.
    while (this.#edges[index + TYPE]) {
      if (
        this.#edges[index + FROM] === from &&
        this.#edges[index + TO] === to &&
        (type === ALL_EDGE_TYPES || this.#edges[index + TYPE] === type)
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
    let size = this.#edges.length;
    while (this.#edges[index + TYPE]) {
      // If the edge at this index was deleted, we can reuse the slot.
      if (isDeleted(this.#edges[index + TYPE])) {
        deletedEdge = index;
      } else if (
        this.#edges[index + FROM] === from &&
        this.#edges[index + TO] === to &&
        // if type === ALL_EDGE_TYPES, return all edges
        (type === ALL_EDGE_TYPES || this.#edges[index + TYPE] === type)
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
    let firstIn = this.getEdge(FIRST_IN, to);
    /** The last incoming edge to the removed edge's terminus. */
    let lastIn = this.getEdge(LAST_IN, to);
    /** The next incoming edge after the removed edge. */
    let nextIn = this.getLinkedEdge(NEXT_IN, edge);
    /** The previous incoming edge before the removed edge. */
    let previousIn = this.findEdgeBefore(NEXT_IN, edge);
    /** The first outgoing edge from the removed edge's origin. */
    let firstOut = this.getEdge(FIRST_OUT, from);
    /** The last outgoing edge from the removed edge's origin. */
    let lastOut = this.getEdge(LAST_OUT, from);
    /** The next outgoing edge after the removed edge. */
    let nextOut = this.getLinkedEdge(NEXT_OUT, edge);
    /** The previous outgoing edge before the removed edge. */
    let previousOut = this.findEdgeBefore(NEXT_OUT, edge);

    // Splice the removed edge out of the linked list of incoming edges.
    // from: previousIn => edge => nextIn
    // to: previousIn => nextIn
    this.unlinkEdge(NEXT_IN, previousIn, edge, nextIn);

    // Splice the removed edge out of the linked list of outgoing edges.
    // from: previousOut => edge => nextOut
    // to: previousOut => nextOut
    this.unlinkEdge(NEXT_OUT, previousOut, edge, nextOut);

    // Update the terminating node's first and last incoming edges.
    if (firstIn === edge) this.setEdge(FIRST_IN, to, nextIn);
    if (lastIn === edge) this.setEdge(LAST_IN, to, previousIn);

    // Update the originating node's first and last outgoing edges.
    if (firstOut === edge) this.setEdge(FIRST_OUT, from, nextOut);
    if (lastOut === edge) this.setEdge(LAST_OUT, from, previousOut);

    this.#typeMaps?.from
      .get(from)
      .get(type)
      .delete(to);

    this.#typeMaps?.to
      .get(to)
      .get(type)
      .delete(from);

    // Mark this slot as DELETED.
    // We do this so that clustered edges can still be found
    // by scanning forward in the array from the first index for
    // the cluster.
    this.#edges[index + TYPE] = DELETED;
    this.#edges[index + FROM] = 0;
    this.#edges[index + TO] = 0;
    this.#edges[index + NEXT_IN] = 0;
    this.#edges[index + NEXT_OUT] = 0;

    this.#numEdges--;
  }

  hasInboundEdges(to: NodeId): boolean {
    return Boolean(this.getEdge(FIRST_IN, to));
  }

  getInboundEdgesByType(to: NodeId): {|type: TEdgeType, from: NodeId|}[] {
    let typeMaps = this.#typeMaps || (this.#typeMaps = buildTypeMaps(this));
    let edges = [];
    if (typeMaps.to.has(to)) {
      for (let [type, nodes] of typeMaps.to.get(to)) {
        for (let from of nodes) {
          edges.push({type: (type: any), from});
        }
      }
    }
    return edges;
  }

  getOutboundEdgesByType(from: NodeId): {|type: TEdgeType, to: NodeId|}[] {
    let typeMaps = this.#typeMaps || (this.#typeMaps = buildTypeMaps(this));
    let edges = [];
    if (typeMaps.from.has(from)) {
      for (let [type, nodes] of typeMaps.from.get(from)) {
        for (let to of nodes) {
          edges.push({type: (type: any), to});
        }
      }
    }
    return edges;
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
  getNodesConnectedFrom(
    from: NodeId,
    type:
      | AllEdgeTypes
      | TEdgeType
      | NullEdgeType
      | Array<TEdgeType | NullEdgeType> = 1,
  ): NodeId[] {
    let typeMaps = this.#typeMaps || (this.#typeMaps = buildTypeMaps(this));

    let isAllEdgeTypes =
      type === ALL_EDGE_TYPES ||
      (Array.isArray(type) && type.includes(ALL_EDGE_TYPES));

    let nodes = [];
    if (typeMaps.from.has(from)) {
      if (isAllEdgeTypes) {
        for (let [, toSet] of typeMaps.from.get(from)) {
          nodes.push(...toSet);
        }
      } else if (Array.isArray(type)) {
        let fromType = typeMaps.from.get(from);
        for (let typeNum of type) {
          if (fromType.has(typeNum)) {
            nodes.push(...fromType.get(typeNum));
          }
        }
      } else {
        if (typeMaps.from.get(from).has((type: any))) {
          nodes.push(...typeMaps.from.get(from).get((type: any)));
        }
      }
    }
    return nodes;
  }

  /**
   * Get the list of nodes connected to this node.
   */
  getNodesConnectedTo(
    to: NodeId,
    type:
      | AllEdgeTypes
      | TEdgeType
      | NullEdgeType
      | Array<TEdgeType | NullEdgeType> = 1,
  ): NodeId[] {
    let typeMaps = this.#typeMaps || (this.#typeMaps = buildTypeMaps(this));

    let isAllEdgeTypes =
      type === ALL_EDGE_TYPES ||
      (Array.isArray(type) && type.includes(ALL_EDGE_TYPES));

    let nodes = [];
    if (typeMaps.to.has(to)) {
      if (isAllEdgeTypes) {
        for (let [, from] of typeMaps.to.get(to)) {
          nodes.push(...from);
        }
      } else if (Array.isArray(type)) {
        let toType = typeMaps.to.get(to);
        for (let typeNum of type) {
          if (toType.has(typeNum)) {
            nodes.push(...toType.get(typeNum));
          }
        }
      } else {
        if (typeMaps.to.get(to).has((type: any))) {
          nodes.push(...typeMaps.to.get(to).get((type: any)));
        }
      }
    }
    return nodes;
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
    hash %= this.#edgeCapacity;
    // 3. Multiply by EDGE_SIZE to select a valid index.
    hash *= EDGE_SIZE;
    // 4. Add 1 to guarantee a truthy result.
    return hash + 1;
  }
}
