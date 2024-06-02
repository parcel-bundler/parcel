// @flow
import assert from 'assert';
import nullthrows from 'nullthrows';
import {SharedBuffer} from './shared-buffer';
import {fromNodeId, toNodeId} from './types';
import {ALL_EDGE_TYPES, type NullEdgeType, type AllEdgeTypes} from './Graph';
import type {NodeId} from './types';

/** The address of the node in the nodes map. */
opaque type NodeAddress = number;

opaque type EdgeHash = number;

/** The address of the edge in the edges map. */
opaque type EdgeAddress = number;

// eslint-disable-next-line no-unused-vars
export type SerializedAdjacencyList<TEdgeType> = {|
  nodes: Uint32Array,
  edges: Uint32Array,
|};

// eslint-disable-next-line no-unused-vars
export type AdjacencyListOptions<TEdgeType> = {|
  /** The initial number of edges to accommodate. */
  initialCapacity?: number,
  /** The max amount by which to grow the capacity. */
  maxGrowFactor?: number,
  /** The min amount by which to grow the capacity. */
  minGrowFactor?: number,
  /** The size after which to grow the capacity by the minimum factor. */
  peakCapacity?: number,
  /** The percentage of deleted edges above which the capacity should shrink. */
  unloadFactor?: number,
  /** The amount by which to shrink the capacity. */
  shrinkFactor?: number,
|};

type AdjacencyListParams = {|
  initialCapacity: number,
  unloadFactor: number,
  maxGrowFactor: number,
  minGrowFactor: number,
  peakCapacity: number,
  shrinkFactor: number,
|};

const DEFAULT_PARAMS: AdjacencyListParams = {
  initialCapacity: 2,
  unloadFactor: 0.3,
  maxGrowFactor: 8,
  minGrowFactor: 2,
  peakCapacity: 2 ** 18,
  shrinkFactor: 0.5,
};

/**
 * An Enum representing the result of a call to `link`.
 *
 * `EdgeAdded`       = `0`: the edge was successfully linked
 * `EdgeExists`      = `1`: the edge already exists
 * `EdgesOverloaded` = `2`: the edge map is overloaded
 * `TooManyDeletes`  = `3`: the edge map has too many deleted edges
 * `NodesOverloaded` = `4`: the node map is overloaded
 */
const LinkResult: {|
  /** The edge was successfully linked */
  EdgeAdded: 0,
  /** The edge already exists */
  EdgeExists: 1,
  /** The edge map is overloaded */
  EdgesOverloaded: 2,
  /** The edge map has too many deleted edges */
  TooManyDeletes: 3,
  /** The node map is overloaded */
  NodesOverloaded: 4,
|} = {
  EdgeAdded: 0,
  EdgeExists: 1,
  EdgesOverloaded: 2,
  TooManyDeletes: 3,
  NodesOverloaded: 4,
};

/**
 * Allow 3 attempts to link an edge before erroring.
 *
 * The three attempts correspond to the three possible inconclusive link results:
 * - `LinkResult.EdgesOverloaded`
 * - `LinkResult.TooManyDeletes`
 * - `LinkResult.NodesOverloaded`
 *
 * If after 3 tries, the link result is still one of these,
 * this is considered an error.
 */
const MAX_LINK_TRIES: 3 = 3;

/**
 * `AdjacencyList` maps nodes to lists of their adjacent nodes.
 *
 * It is implemented as a hashmap of nodes, where each node has
 * doubly linked lists of edges of each unique edge type.
 * The edges are stored in a separate hashmap, where each edge has
 * a pointer to the originating node, the terminating node, and
 * the next and previous edges to and from adjacent nodes.
 *
 * The hash maps are each stored in a `Uint32Array` backed
 * by a `SharedArrayBuffer`. See `SharedTypeMap` for more details.
 *
 * It's primary interface is through the `getNodeIdsConnectedFrom`
 * and `getNodeIdsConnectedTo` methods, which return the list of
 * nodes connected from or to a given node, respectively.
 *
 * It is also possible to get the lists of edges connected from or to
 * a given node, using the `getOutboundEdgesByType` and
 * `getInboundEdgesByType` methods.
 *
 */
export default class AdjacencyList<TEdgeType: number = 1> {
  #nodes /*: NodeTypeMap<TEdgeType | NullEdgeType> */;
  #edges /*: EdgeTypeMap<TEdgeType | NullEdgeType> */;

  #params /*: AdjacencyListParams */;

  /**
   * Create a new `AdjacencyList` in one of two ways:
   * - with specified options, or
   * - with data serialized from a previous `AdjacencyList`.
   */
  constructor(
    opts?:
      | SerializedAdjacencyList<TEdgeType | NullEdgeType>
      | AdjacencyListOptions<TEdgeType | NullEdgeType>,
  ) {
    let nodes;
    let edges;

    if (opts?.nodes) {
      ({nodes, edges} = opts);
      this.#nodes = new NodeTypeMap(nodes);
      this.#edges = new EdgeTypeMap(edges);
      this.#params = {...DEFAULT_PARAMS, initialCapacity: this.#edges.capacity};
    } else {
      this.#params = {...DEFAULT_PARAMS, ...opts};

      let {initialCapacity} = this.#params;

      // TODO: Find a heuristic for right-sizing nodes.
      // e.g., given an average ratio of `e` edges for every `n` nodes,
      // init nodes with `capacity * n / e`.
      let initialNodeCapacity = 2;

      NodeTypeMap.assertMaxCapacity(initialNodeCapacity);
      EdgeTypeMap.assertMaxCapacity(initialCapacity);

      this.#nodes = new NodeTypeMap(initialNodeCapacity);
      this.#edges = new EdgeTypeMap(initialCapacity);
    }
  }

  /**
   * Create a new `AdjacencyList` with data serialized
   * from another `AdjacencyList`.
   */
  static deserialize(
    opts: SerializedAdjacencyList<TEdgeType>,
  ): AdjacencyList<TEdgeType> {
    return new AdjacencyList(opts);
  }

  /**
   * Returns a serializable object of the nodes and edges in the AdjacencyList.
   */
  serialize(): SerializedAdjacencyList<TEdgeType> {
    return {
      nodes: this.#nodes.data,
      edges: this.#edges.data,
    };
  }

  /** Statistics about the current state of the `AdjacencyList`. */
  get stats(): {|
    /** The maximum number of edges the graph can contain. */
    capacity: number,
    /** The number of nodes in the graph. */
    nodes: number,
    /** The number of edge types associated with nodes in the graph. */
    nodeEdgeTypes: number,
    /** The size of the raw nodes buffer, in mb. */
    nodeBufferSize: string,
    /** The current load on the nodes array. */
    nodeLoad: string,
    /** The number of edges in the graph. */
    edges: number,
    /** The number of edges deleted from the graph. */
    deleted: number,
    /** The number of unique edge types in the graph. */
    edgeTypes: number,
    /** The size of the raw edges buffer, in mb. */
    edgeBufferSize: string,
    /** The current load on the edges array, including deletes. */
    edgeLoadWithDeletes: string,
    /** The current load on the edges array. */
    edgeLoad: string,
    /** The total number of edge hash collisions. */
    collisions: number,
    /** The number of collisions for the most common hash. */
    maxCollisions: number,
    /** The average number of collisions per hash. */
    avgCollisions: number,
    /**
     * The actual distribution of hashes vs. the expected (uniform) distribution.
     *
     * From: https://en.wikipedia.org/wiki/Hash_function#Testing_and_measurement
     *
     * > A ratio within one confidence interval (0.95 - 1.05) is indicative
     * > that the hash function...has an expected uniform distribution.
     */
    uniformity: number,
  |} {
    let edgeTypes = new Set();
    let buckets = new Map();
    for (let {from, to, type} of this.getAllEdges()) {
      let hash = this.#edges.hash(from, to, type);
      let bucket = buckets.get(hash) || new Set();
      let key = `${String(from)}, ${String(to)}, ${String(type)}`;
      assert(!bucket.has(key), `Duplicate node detected: ${key}`);
      bucket.add(key);
      buckets.set(hash, bucket);
      edgeTypes.add(type);
    }

    let maxCollisions = 0;
    let collisions = 0;
    let distribution = 0;
    /**
     * The expected distribution of hashes across available hash buckets.
     *
     * See: https://en.wikipedia.org/wiki/Hash_function#Testing_and_measurement
     */
    let uniformDistribution =
      (this.#edges.count / (2 * this.#edges.capacity)) *
      (this.#edges.count + 2 * this.#edges.capacity - 1);

    for (let bucket of buckets.values()) {
      maxCollisions = Math.max(maxCollisions, bucket.size - 1);
      collisions += bucket.size - 1;
      distribution += (bucket.size * (bucket.size + 1)) / 2;
    }

    return {
      capacity: this.#edges.capacity,

      nodes: fromNodeId(this.#nodes.nextId),
      nodeEdgeTypes: this.#nodes.count,
      nodeLoad: `${Math.round(this.#nodes.load * 100)}%`,
      nodeBufferSize: this.#nodes.bufferSize,

      edges: this.#edges.count,
      deleted: this.#edges.deletes,
      edgeTypes: edgeTypes.size,
      edgeLoad: `${Math.round(this.#edges.load * 100)}%`,
      edgeLoadWithDeletes: `${Math.round(
        this.#edges.getLoad(this.#edges.count + this.#edges.deletes) * 100,
      )}%`,
      edgeBufferSize: this.#edges.bufferSize,

      collisions,
      maxCollisions,
      avgCollisions:
        Math.round((collisions / this.#edges.count) * 100) / 100 || 0,
      uniformity:
        Math.round((distribution / uniformDistribution) * 100) / 100 || 0,
    };
  }

  /**
   * Resize the internal nodes array.
   *
   * This is used in `addNode` and in `addEdge` when
   * the `nodes` array is at capacity,
   */
  resizeNodes(size: number) {
    let nodes = this.#nodes;
    // Allocate the required space for a `nodes` map of the given `size`.
    this.#nodes = new NodeTypeMap(size);
    // Copy the existing nodes into the new array.
    this.#nodes.set(nodes.data);
  }

  /**
   * Resize the internal edges array.
   *
   * This is used in `addEdge` when the `edges` array is at capacity.
   */
  resizeEdges(size: number) {
    // Allocate the required space for new `nodes` and `edges` maps.
    let edges = new EdgeTypeMap(size);
    let nodes = new NodeTypeMap(this.#nodes.capacity);

    // Copy the existing edges into the new array.
    nodes.nextId = this.#nodes.nextId;
    this.#edges.forEach(
      edge =>
        void link(
          this.#edges.from(edge),
          this.#edges.to(edge),
          this.#edges.typeOf(edge),
          edges,
          nodes,
          this.#params.unloadFactor,
        ),
    );

    // We expect to preserve the same number of edges.
    assert(
      this.#edges.count === edges.count,
      `Edge mismatch! ${this.#edges.count} does not match ${edges.count}.`,
    );

    // Finally, copy the new data arrays over to this graph.
    this.#nodes = nodes;
    this.#edges = edges;
  }

  /**
   * Adds a node to the graph.
   *
   * Note that this method does not increment the node count
   * (that only happens in `addEdge`), it _may_ preemptively resize
   * the nodes array if it is at capacity, under the assumption that
   * at least 1 edge to or from this new node will be added.
   *
   * Returns the id of the added node.
   */
  addNode(): NodeId {
    let id = this.#nodes.getId();
    if (this.#nodes.getLoad() >= 1) {
      this.resizeNodes(
        increaseNodeCapacity(this.#nodes.capacity, this.#params),
      );
    }

    return id;
  }

  /**
   * Adds an edge to the graph.
   *
   * This method will increment the edge count, and it _may_
   * also increment the node count, if the originating or
   * terminating node does not yet have any edges of the given type.
   *
   * If either the `nodes` or `edges` arrays are at capacity,
   * this method will resize them before adding.
   *
   * Furthermore, if the `edges` array has a high number of
   * deleted edges, it may reclaim the space before adding.
   *
   * Returns `true` if the edge was added,
   * or `false` if the edge already exists.
   */
  addEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): boolean {
    assert(from < this.#nodes.nextId, `Node ${from} does not exist.`);
    assert(to < this.#nodes.nextId, `Node ${to} does not exist.`);
    assert(type > 0, `Unsupported edge type ${type}`);

    let result;
    let tries = 0;

    do {
      assert(tries++ < MAX_LINK_TRIES, 'Failed to addEdge too many times!');

      result = link(
        from,
        to,
        type,
        this.#edges,
        this.#nodes,
        this.#params.unloadFactor,
      );

      // Sometimes we need to resize before we can add.
      switch (result) {
        case LinkResult.NodesOverloaded: {
          this.resizeNodes(
            increaseNodeCapacity(this.#nodes.capacity, this.#params),
          );
          break;
        }
        case LinkResult.EdgesOverloaded: {
          this.resizeEdges(
            increaseEdgeCapacity(this.#edges.capacity, this.#params),
          );
          break;
        }
        case LinkResult.TooManyDeletes: {
          this.resizeEdges(
            decreaseEdgeCapacity(this.#edges.capacity, this.#params),
          );
          break;
        }
      }
    } while (result > LinkResult.EdgeExists);

    return result === LinkResult.EdgeAdded;
  }

  /**
   * Iterate over all edges in insertion order.
   */
  *getAllEdges(): Iterator<{|
    type: TEdgeType | NullEdgeType,
    from: NodeId,
    to: NodeId,
  |}> {
    for (let edge of this.#edges) {
      yield {
        from: this.#edges.from(edge),
        to: this.#edges.to(edge),
        type: this.#edges.typeOf(edge),
      };
    }
  }

  /**
   * Check if the graph has an edge connecting the `from` and `to` nodes.
   */
  hasEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType | Array<TEdgeType | NullEdgeType> = 1,
  ): boolean {
    let hasEdge = (type: TEdgeType | NullEdgeType) => {
      let hash = this.#edges.hash(from, to, type);
      return this.#edges.addressOf(hash, from, to, type) !== null;
    };

    if (Array.isArray(type)) {
      return type.some(hasEdge);
    }

    return hasEdge(type);
  }

  /**
   * Remove an edge connecting the `from` and `to` nodes.
   *
   * Note that space for the deleted edge is not reclaimed
   * until the `edges` array is resized.
   *
   * This method will increment the edge delete count.
   */
  removeEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): void {
    let hash = this.#edges.hash(from, to, type);
    let edge = this.#edges.addressOf(hash, from, to, type);

    // The edge is not in the graph; do nothing.
    if (edge === null) return;

    let toNode = nullthrows(this.#nodes.addressOf(to, type));
    let fromNode = nullthrows(this.#nodes.addressOf(from, type));

    // Update the terminating node's first and last incoming edges.
    this.#nodes.unlinkIn(
      toNode,
      edge,
      this.#edges.prevIn(edge),
      this.#edges.nextIn(edge),
    );

    // Update the originating node's first and last outgoing edges.
    this.#nodes.unlinkOut(
      fromNode,
      edge,
      this.#edges.prevOut(edge),
      this.#edges.nextOut(edge),
    );

    // Splice the removed edge out of the linked list of edges in the bucket.
    this.#edges.unlink(hash, edge);
    // Splice the removed edge out of the linked list of incoming edges.
    this.#edges.unlinkIn(edge);
    // Splice the removed edge out of the linked list of outgoing edges.
    this.#edges.unlinkOut(edge);
    // Finally, delete the edge.
    this.#edges.delete(edge);
  }

  /**
   * Check if the given node has any edges incoming from other nodes.
   *
   * Essentially, this is an orphan check. If a node has no incoming edges,
   * it (and its entire subgraph) is completely disconnected from the
   * rest of the graph.
   */
  hasInboundEdges(to: NodeId): boolean {
    let node = this.#nodes.head(to);
    while (node !== null) {
      if (this.#nodes.firstIn(node) !== null) return true;
      node = this.#nodes.next(node);
    }
    return false;
  }

  /**
   * Get a list of every node (labeled `from`) connecting _to_
   * the given `to` node, along with the edge `type` connecting them.
   */
  getInboundEdgesByType(
    to: NodeId,
  ): {|type: TEdgeType | NullEdgeType, from: NodeId|}[] {
    let edges = [];
    let node = this.#nodes.head(to);
    while (node !== null) {
      let type = this.#nodes.typeOf(node);
      let edge = this.#nodes.firstIn(node);
      while (edge !== null) {
        let from = this.#edges.from(edge);
        edges.push({from, type});
        edge = this.#edges.nextIn(edge);
      }
      node = this.#nodes.next(node);
    }
    return edges;
  }

  /**
   * Get a list of every node (labeled `to`) connected _from_
   * the given `from` node, along with the edge `type` connecting them.
   */
  getOutboundEdgesByType(
    from: NodeId,
  ): {|type: TEdgeType | NullEdgeType, to: NodeId|}[] {
    let edges = [];
    let node = this.#nodes.head(from);
    while (node !== null) {
      let type = this.#nodes.typeOf(node);
      let edge = this.#nodes.firstOut(node);
      while (edge !== null) {
        let to = this.#edges.to(edge);
        edges.push({to, type});
        edge = this.#edges.nextOut(edge);
      }
      node = this.#nodes.next(node);
    }
    return edges;
  }

  /**
   * Get the list of node ids connected from this node.
   *
   * If `type` is specified, only return nodes connected by edges of that type.
   * If `type` is an array, return nodes connected by edges of any of those types.
   * If `type` is `AllEdgeTypes` (`-1`), return nodes connected by edges of any type.
   */
  getNodeIdsConnectedFrom(
    from: NodeId,
    type:
      | AllEdgeTypes
      | TEdgeType
      | NullEdgeType
      | Array<TEdgeType | NullEdgeType> = 1,
  ): NodeId[] {
    let matches = node =>
      type === ALL_EDGE_TYPES ||
      (Array.isArray(type)
        ? type.includes(this.#nodes.typeOf(node))
        : type === this.#nodes.typeOf(node));
    let nodes = [];
    let seen = new Set<NodeId>();
    let node = this.#nodes.head(from);
    while (node !== null) {
      if (matches(node)) {
        let edge = this.#nodes.firstOut(node);
        while (edge !== null) {
          let to = this.#edges.to(edge);
          if (!seen.has(to)) {
            nodes.push(to);
            seen.add(to);
          }
          edge = this.#edges.nextOut(edge);
        }
      }
      node = this.#nodes.next(node);
    }
    return nodes;
  }

  forEachNodeIdConnectedFromReverse(
    from: NodeId,
    fn: (nodeId: NodeId) => boolean,
  ) {
    let node = this.#nodes.head(from);
    while (node !== null) {
      let edge = this.#nodes.lastOut(node);
      while (edge !== null) {
        let to = this.#edges.to(edge);
        if (fn(to)) {
          return;
        }
        edge = this.#edges.prevOut(edge);
      }
      node = this.#nodes.next(node);
    }
  }

  /**
   * Get the list of node ids connected to this node.
   *
   * If `type` is specified, only return nodes connected by edges of that type.
   * If `type` is an array, return nodes connected by edges of any of those types.
   * If `type` is `AllEdgeTypes` (`-1`), return nodes connected by edges of any type.
   */
  getNodeIdsConnectedTo(
    to: NodeId,
    type:
      | AllEdgeTypes
      | TEdgeType
      | NullEdgeType
      | Array<TEdgeType | NullEdgeType> = 1,
  ): NodeId[] {
    let matches = node =>
      type === ALL_EDGE_TYPES ||
      (Array.isArray(type)
        ? type.includes(this.#nodes.typeOf(node))
        : type === this.#nodes.typeOf(node));

    let nodes = [];
    let seen = new Set<NodeId>();
    let node = this.#nodes.head(to);
    while (node !== null) {
      if (matches(node)) {
        let edge = this.#nodes.firstIn(node);
        while (edge !== null) {
          let from = this.#edges.from(edge);
          if (!seen.has(from)) {
            nodes.push(from);
            seen.add(from);
          }
          edge = this.#edges.nextIn(edge);
        }
      }
      node = this.#nodes.next(node);
    }
    return nodes;
  }

  inspect(): any {
    return {
      nodes: this.#nodes.inspect(),
      edges: this.#edges.inspect(),
    };
  }
}

/**
 * `SharedTypeMap` is a hashmap of items,
 * where each item has its own 'type' field.
 *
 * The `SharedTypeMap` is backed by a shared array buffer of fixed length.
 * The buffer is partitioned into:
 * - a header, which stores the capacity and number of items in the map,
 * - a hash table, which is an array of pointers to linked lists of items
 *   with the same hash,
 * - an items array, which is where the linked items are stored.
 *
 *            hash table                 item
 *            (capacity)             (ITEM_SIZE)
 *         ┌──────┴──────┐             ┌──┴──┐
 *   ┌──┬──┬──┬───────┬──┬──┬──┬───────┬──┬──┐
 *   │  │  │  │  ...  │  │  │  │  ...  │  │  │
 *   └──┴──┴──┴───────┴──┴──┴──┴───────┴──┴──┘
 *   └──┬──┘             └─────────┬─────────┘
 *    header                     items
 * (HEADER_SIZE)         (capacity * ITEM_SIZE)
 *
 *
 * An item is added with a hash key that fits within the range of the hash
 * table capacity. The item is stored at the next available address after the
 * hash table, and a pointer to the address is stored in the hash table at
 * the index matching the hash. If the hash is already pointing at an item,
 * the pointer is stored in the `next` field of the existing item instead.
 *
 *       hash table                          items
 * ┌─────────┴────────┐┌───────────────────────┴────────────────────────┐
 *    0    1    2        11       17        23       29      35
 * ┌───┐┌───┐┌───┐┌───┐┌───┬───┐┌───┬───┐┌───┬───┐┌───┬───┐┌───┬───┐┌───┐
 * │17 ││11 ││35 ││...││23 │ 1 ││29 │ 1 ││ 0 │ 2 ││ 0 │ 2 ││ 0 │ 1 ││...│
 * └───┘└───┘└───┘└───┘└───┴───┘└───┴───┘└───┴───┘└───┴───┘└───┴───┘└───┘
 *   │    │    │         ▲        ▲        ▲        ▲        ▲
 *   └────┼────┼─────────┼────────┴────────┼────────┘        │
 *        └────┼─────────┴─────────────────┘                 │
 *             └─────────────────────────────────────────────┘
 */
export class SharedTypeMap<TItemType, THash, TAddress: number>
  implements Iterable<TAddress>
{
  /**
   * The header for the `SharedTypeMap` comprises 2 4-byte chunks:
   *
   * struct SharedTypeMapHeader {
   *   int capacity;
   *   int count;
   * }
   *
   * ┌──────────┬───────┐
   * │ CAPACITY │ COUNT │
   * └──────────┴───────┘
   */
  static HEADER_SIZE: number = 2;
  /** The offset from the header where the capacity is stored. */
  static #CAPACITY: 0 = 0;
  /** The offset from the header where the count is stored. */
  static #COUNT: 1 = 1;

  /**
   * Each item in `SharedTypeMap` comprises 2 4-byte chunks:
   *
   * struct Node {
   *   int next;
   *   int type;
   * }
   *
   * ┌──────┬──────┐
   * │ NEXT │ TYPE │
   * └──────┴──────┘
   */
  static ITEM_SIZE: number = 2;
  /** The offset at which a link to the next item in the same bucket is stored. */
  static #NEXT: 0 = 0;
  /** The offset at which an item's type is stored. */
  static #TYPE: 1 = 1;

  /** The largest possible capacity. */
  static get MAX_CAPACITY(): number {
    return Math.floor(
      // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Invalid_array_length#what_went_wrong
      (2 ** 31 - 1 - this.HEADER_SIZE) / this.ITEM_SIZE,
    );
  }

  /** Assert that the given `capacity` does not exceed `MAX_CAPACITY`. */
  static assertMaxCapacity(capacity: number): void {
    assert(capacity <= this.MAX_CAPACITY, `${this.name} capacity overflow!`);
  }

  data: Uint32Array;

  /** The total number of items that can fit in the map. */
  get capacity(): number {
    return this.data[SharedTypeMap.#CAPACITY];
  }

  /** The number of items in the map. */
  get count(): number {
    return this.data[SharedTypeMap.#COUNT];
  }

  /** The ratio of the count to the capacity. */
  get load(): number {
    return this.getLoad();
  }

  /** The total length of the map, in bytes. */
  get length(): number {
    return this.getLength();
  }

  /** The address of the first item in the map. */
  get addressableLimit(): number {
    return this.constructor.HEADER_SIZE + this.capacity;
  }

  /** The size of the map in mb, as a localized string. */
  get bufferSize(): string {
    return `${(this.data.byteLength / 1024 / 1024).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} mb`;
  }

  /**
   * Create a new `SharedTypeMap` in one of two ways:
   * - with a capacity of `capacityOrData` if it is a number,
   * - or with `capacityOrData` as its data, if it is a `Uint32Array`.
   */
  constructor(capacityOrData: number | Uint32Array) {
    if (typeof capacityOrData === 'number') {
      let {BYTES_PER_ELEMENT} = Uint32Array;
      let CAPACITY = SharedTypeMap.#CAPACITY;
      // $FlowFixMe[incompatible-call]
      this.data = new Uint32Array(
        new SharedBuffer(this.getLength(capacityOrData) * BYTES_PER_ELEMENT),
      );
      this.data[CAPACITY] = capacityOrData;
    } else {
      this.data = capacityOrData;
      assert(this.getLength() === this.data.length, 'Data appears corrupt.');
    }
  }

  /**
   * Overwrite the data in this map with the given `data`.
   *
   * The `data` is expected to conform to the same
   * partitioning and schema as the data in this map,
   * and is expected to be of equal or smaller capacity to this map.
   */
  set(data: Uint32Array): void {
    let {HEADER_SIZE, ITEM_SIZE} = this.constructor;
    let NEXT = SharedTypeMap.#NEXT;
    let COUNT = SharedTypeMap.#COUNT;
    let CAPACITY = SharedTypeMap.#CAPACITY;

    let delta = this.capacity - data[CAPACITY];
    assert(delta >= 0, 'Cannot copy to a map with smaller capacity.');

    // Copy the header.
    this.data.set(data.subarray(COUNT, HEADER_SIZE), COUNT);

    // Copy the hash table.
    let toTable = this.data.subarray(HEADER_SIZE, HEADER_SIZE + this.capacity);
    toTable.set(data.subarray(HEADER_SIZE, HEADER_SIZE + data[CAPACITY]));
    // Offset first links to account for the change in table capacity.
    let max = toTable.length;
    for (let i = 0; i < max; i++) {
      if (toTable[i]) toTable[i] += delta;
    }

    // Copy the items.
    let toItems = this.data.subarray(HEADER_SIZE + this.capacity);
    toItems.set(data.subarray(HEADER_SIZE + data[CAPACITY]));
    // Offset next links to account for the change in table capacity.
    max = toItems.length;
    for (let i = 0; i < max; i += ITEM_SIZE) {
      if (toItems[i + NEXT]) toItems[i + NEXT] += delta;
    }
  }

  /**
   * Given a `count` (defaulting to `this.count`),
   * get the load on the map.
   *
   * The load is the ratio of the `count` the capacity of the map.
   *
   * If the load is `1`, it means the map is at capacity, and needs
   * to be resized before adding more items.
   */
  getLoad(count: number = this.count): number {
    return count / this.capacity;
  }

  /**
   * Given a `capacity` (defaulting to `this.capacity`),
   * get the length of the map, in bytes.
   */
  getLength(capacity: number = this.capacity): number {
    let {HEADER_SIZE, ITEM_SIZE} = this.constructor;
    return capacity + HEADER_SIZE + ITEM_SIZE * capacity;
  }

  /** Get the next available address in the map. */
  getNextAddress(): TAddress {
    let {HEADER_SIZE, ITEM_SIZE} = this.constructor;
    return (HEADER_SIZE + this.capacity + this.count * ITEM_SIZE: any);
  }

  /** Get the address of the first item with the given hash. */
  head(hash: THash): TAddress | null {
    let {HEADER_SIZE} = this.constructor;
    return (this.data[HEADER_SIZE + (hash: any)]: any) || null;
  }

  /** Get the address of the next item with the same hash as the given item. */
  next(item: TAddress): TAddress | null {
    let NEXT = SharedTypeMap.#NEXT;
    return (this.data[(item: any) + NEXT]: any) || null;
  }

  /** Get the type of the item at the given `item` address. */
  typeOf(item: TAddress): TItemType {
    return (this.data[item + SharedTypeMap.#TYPE]: any);
  }

  /**
   * Store an item of `type` at the `item` address and
   * link the address to the `hash` bucket.
   */
  link(hash: THash, item: TAddress, type: TItemType): void {
    let COUNT = SharedTypeMap.#COUNT;
    let NEXT = SharedTypeMap.#NEXT;
    let TYPE = SharedTypeMap.#TYPE;
    let {HEADER_SIZE} = this.constructor;

    this.data[item + TYPE] = (type: any);

    let prev = this.head(hash);
    if (prev !== null) {
      let next = this.next(prev);
      while (next !== null) {
        prev = next;
        next = this.next(next);
      }
      this.data[prev + NEXT] = item;
    } else {
      // This is the first item in the bucket!
      this.data[HEADER_SIZE + (hash: any)] = item;
    }
    this.data[COUNT]++;
  }

  /**
   * Remove the link to the `item` address from the `hash` bucket.
   */
  unlink(hash: THash, item: TAddress): void {
    let COUNT = SharedTypeMap.#COUNT;
    let NEXT = SharedTypeMap.#NEXT;
    let TYPE = SharedTypeMap.#TYPE;
    let {HEADER_SIZE} = this.constructor;

    this.data[item + TYPE] = 0;

    let head = this.head(hash);
    // No bucket to unlink from.
    if (head === null) return;

    let next = this.next(item);
    let prev = null;
    let candidate = head;
    while (candidate !== null && candidate !== item) {
      prev = candidate;
      candidate = this.next(candidate);
    }
    if (prev !== null && next !== null) {
      this.data[prev + NEXT] = next;
    } else if (prev !== null) {
      this.data[prev + NEXT] = 0;
    } else if (next !== null) {
      this.data[HEADER_SIZE + (hash: any)] = next;
    } else {
      this.data[HEADER_SIZE + (hash: any)] = 0;
    }
    this.data[item + NEXT] = 0;
    this.data[COUNT]--;
  }

  forEach(cb: (item: TAddress) => void): void {
    let max = this.count;
    let len = this.length;
    let {ITEM_SIZE} = this.constructor;
    for (
      let i = this.addressableLimit, count = 0;
      i < len && count < max;
      i += ITEM_SIZE
    ) {
      // Skip items that don't have a type.
      if (this.typeOf((i: any))) {
        cb((i: any));
        count++;
      }
    }
  }

  // Trick Flow into believing in `Symbol.iterator`.
  // See https://github.com/facebook/flow/issues/1163#issuecomment-353523840
  /*:: @@iterator(): Iterator<TAddress> { return ({}: any); } */
  // $FlowFixMe[unsupported-syntax]
  *[Symbol.iterator](): Iterator<TAddress> {
    let max = this.count;
    let len = this.length;
    let {ITEM_SIZE} = this.constructor;
    for (
      let i = this.addressableLimit, count = 0;
      i < len && count < max;
      i += ITEM_SIZE
    ) {
      if (this.data.subarray(i, i + ITEM_SIZE).some(Boolean)) {
        yield (i: any);
        count++;
      }
    }
  }

  inspect(): {|
    header: Uint32Array,
    table: Uint32Array,
    data: Uint32Array,
  |} {
    const {HEADER_SIZE} = this.constructor;
    let min = this.addressableLimit;

    return {
      header: this.data.subarray(0, HEADER_SIZE),
      table: this.data.subarray(HEADER_SIZE, min),
      data: this.data.subarray(min),
    };
  }
}

/**
 * Nodes are stored in a `SharedTypeMap`, keyed on node id plus an edge type.
 * This means that for any given unique node id, there may be `e` nodes in the
 * map, where `e` is the number of unique edge types in the graph.
 *
 * The _hash_ for a node is simply the node id (as issued by `getId`),
 * and forms the head of linked list of unique _edge types_ connected
 * to or from the same node id.
 *
 * In addition to a unique edge type, each Node contains the heads and tails
 * of doubly linked lists of incoming and outgoing edges of the same type.
 *
 * Note that the links in the doubly linked lists are Edges (not Nodes),
 * which are stored in a corresponding `EdgeTypeMap`.
 */
export class NodeTypeMap<TEdgeType> extends SharedTypeMap<
  TEdgeType,
  NodeId,
  NodeAddress,
> {
  /**
   * In addition to the header defined by `SharedTypeMap`, the header for
   * the node map includes a 4-byte `nextId` chunk:
   *
   * struct NodeTypeMapHeader {
   *   int capacity; // from `SharedTypeMap`
   *   int count; // from `SharedTypeMap`
   *   int nextId;
   * }
   *
   * ┌──────────┬───────┬─────────┐
   * │ CAPACITY │ COUNT │ NEXT_ID │
   * └──────────┴───────┴─────────┘
   *
   * The `nextId` is a count of the number of times `getId` has been called.
   * This is distinct concept from the `count`, which tracks the number of times
   * `add` has been called.
   *
   * The reason for this distinction is that `getId` is called once per node
   * (to issue a _unique_ id) and will _always increment_ the `nextId` counter,
   * whereas `add` is called once per edge, and will only increment the `count`
   * if the _type_ of edge is new for the given node.
   */
  static HEADER_SIZE: number = 3;
  /** The offset from the header where the next available node id is stored. */
  static #NEXT_ID = 2;

  /**
   * In addition to the item fields defined by `SharedTypeMap`,
   * each node includes another 4 4-byte chunks:
   *
   * struct Node {
   *   int next; // from `SharedTypeMap`
   *   int type; // from `SharedTypeMap`
   *   int firstIn;
   *   int firstOut;
   *   int lastIn;
   *   int lastOut;
   * }
   *
   * ┌──────┬──────┬──────────┬───────────┬─────────┬──────────┐
   * │ NEXT │ TYPE │ FIRST_IN │ FIRST_OUT │ LAST_IN │ LAST_OUT │
   * └──────┴──────┴──────────┴───────────┴─────────┴──────────┘
   *
   * The `Node` implicitly maps a node id (the hash the node was added with)
   * to the first and last incoming and outgoing edges of the same _edge type_.
   */
  static ITEM_SIZE: number = 6;
  /** The offset at which a node's first incoming edge of this type is stored. */
  static #FIRST_IN = 2;
  /** The offset at which a node's first outgoing edge of this type is stored. */
  static #FIRST_OUT = 3;
  /** The offset at which a node's last incoming edge of this type is stored. */
  static #LAST_IN = 4;
  /** The offset at which a node's last outgoing edge of this type is stored. */
  static #LAST_OUT = 5;

  get nextId(): NodeId {
    return toNodeId(this.data[NodeTypeMap.#NEXT_ID]);
  }
  set nextId(nextId: NodeId) {
    this.data[NodeTypeMap.#NEXT_ID] = fromNodeId(nextId);
  }

  /**
   * Get the load on the node map.
   *
   * The load is the greater of either:
   * - the ratio of the number of node ids to the capacity of the map,
   * - or the ratio of the `count` to the capacity of the map.
   *
   * if `count` is not provided, the default is the number of items
   * currently added to the map.
   */
  getLoad(count?: number): number {
    return Math.max(
      fromNodeId(this.nextId) / this.capacity,
      super.getLoad(count),
    );
  }

  /** Increment the node counter to get a unique node id. */
  getId(): NodeId {
    return toNodeId(this.data[NodeTypeMap.#NEXT_ID]++);
  }

  /**
   * Add new lists of edges of the given `type` to and from the given `node`.
   */
  add(node: NodeId, type: TEdgeType): NodeAddress {
    let index = fromNodeId(node);
    assert(
      index >= 0 && index < this.data[NodeTypeMap.#NEXT_ID],
      `Invalid node id ${String(node)} (${this.data[NodeTypeMap.#NEXT_ID]})`,
    );
    let address = this.getNextAddress();
    this.link(node, address, type);
    return address;
  }

  /**
   * Get the address of the lists edges of the given `type`
   * to and from the given `node`.
   */
  addressOf(node: NodeId, type: TEdgeType): NodeAddress | null {
    let address = this.head(node);
    while (address !== null) {
      if (this.typeOf(address) === type) {
        return address;
      }
      address = this.next(address);
    }
    return null;
  }

  /**
   * Given a `node` address, get the _head_ of the linked list
   * of incoming edges of the same type to the same node.
   */
  firstIn(node: NodeAddress): EdgeAddress | null {
    return this.data[node + NodeTypeMap.#FIRST_IN] || null;
  }

  /**
   * Given a `node` address, get the _head_ of the linked list
   * of outgoing edges of the same type from the same node.
   */
  firstOut(node: NodeAddress): EdgeAddress | null {
    return this.data[node + NodeTypeMap.#FIRST_OUT] || null;
  }

  /**
   * Given a `node` address, get the _tail_ of the linked list
   * of incoming edges of the same type to the same node.
   */
  lastIn(node: NodeAddress): EdgeAddress | null {
    return this.data[node + NodeTypeMap.#LAST_IN] || null;
  }

  /**
   * Given a `node` address, get the _tail_ of the linked list
   * of outgoing edges of the same type from the same node.
   */
  lastOut(node: NodeAddress): EdgeAddress | null {
    return this.data[node + NodeTypeMap.#LAST_OUT] || null;
  }

  /**
   * Set `edge` as the last incoming edge to `node`.
   * If `node` has no incoming edges, set `edge`
   * as the first incoming edge, as well.
   *
   * Returns the address of the old last incoming edge, if any.
   */
  linkIn(node: NodeAddress, edge: EdgeAddress): EdgeAddress | null {
    let first = this.firstIn(node);
    let last = this.lastIn(node);
    if (first === null) this.data[node + NodeTypeMap.#FIRST_IN] = edge;
    this.data[node + NodeTypeMap.#LAST_IN] = edge;
    return last;
  }

  /**
   * If `edge` is the last incoming edge to `node`,
   * update the node's last incoming edge to `prev`.
   *
   * If `edge` is the first incoming edge to `node`,
   * update the node's first incoming edge to `next`.
   */
  unlinkIn(
    node: NodeAddress,
    edge: EdgeAddress,
    prev: EdgeAddress | null,
    next: EdgeAddress | null,
  ): void {
    let first = this.firstIn(node);
    let last = this.lastIn(node);
    if (last === edge) {
      this.data[node + NodeTypeMap.#LAST_IN] = prev === null ? 0 : prev;
    }
    if (first === edge) {
      this.data[node + NodeTypeMap.#FIRST_IN] = next === null ? 0 : next;
    }
  }

  /**
   * Set `edge` as the last outgoing edge from `node`.
   * If `node` has no outgoing edges, set `edge`
   * as the first outgoing edge, as well.
   *
   * Returns the address of the old last outgoing edge, if any.
   */
  linkOut(node: NodeAddress, edge: EdgeAddress): EdgeAddress | null {
    let first = this.firstOut(node);
    let last = this.lastOut(node);
    if (first === null) this.data[node + NodeTypeMap.#FIRST_OUT] = edge;
    this.data[node + NodeTypeMap.#LAST_OUT] = edge;
    return last;
  }

  /**
   * If `edge` is the last outgoing edge from `node`,
   * update the node's last outgoing edge to `prev`.
   *
   * If `edge` is the first outgoing edge from `node`,
   * update the node's first outgoing edge to `next`.
   */
  unlinkOut(
    node: NodeAddress,
    edge: EdgeAddress,
    prev: EdgeAddress | null,
    next: EdgeAddress | null,
  ): void {
    let first = this.firstOut(node);
    let last = this.lastOut(node);
    if (last === edge) {
      this.data[node + NodeTypeMap.#LAST_OUT] = prev === null ? 0 : prev;
    }
    if (first === edge) {
      this.data[node + NodeTypeMap.#FIRST_OUT] = next === null ? 0 : next;
    }
  }
}

/**
 * Edges are stored in a `SharedTypeMap`,
 * keyed on the 'from' and 'to' node ids, and the edge type.
 *
 * The _hash_ for an edge is a hash of the edge's `from`, `to`, and `type` values,
 * and forms the head of linked list of edges with the same hash.
 *
 * In addition to the `from`, `to` and `type` values, each Edge contains
 * the next and previous links of doubly linked lists of the _adjacent_ edges
 * of the same type, both incoming to the `to` node, and outgoing from
 * the `from` node.
 */
export class EdgeTypeMap<TEdgeType> extends SharedTypeMap<
  TEdgeType,
  EdgeHash,
  EdgeAddress,
> {
  /**
   * In addition to the header defined by `SharedTypeMap`, the header for
   * the edge map includes a 4-byte `deletes` chunk:
   *
   * struct EdgeTypeMapHeader {
   *   int capacity; // from `SharedTypeMap`
   *   int count; // from `SharedTypeMap`
   *   int deletes;
   * }
   *
   * ┌──────────┬───────┬─────────┐
   * │ CAPACITY │ COUNT │ DELETES │
   * └──────────┴───────┴─────────┘
   *
   * Since new edges are always appended, the space for deleted edges
   * is not reused. Instead, the `deletes` count is incremented when an
   * edge is deleted. The next available address is calculated by
   * adding the `count` and `deletes` values to the header size.
   *
   * The only way to reclaim the space used by deleted edges is to resize the map.
   */
  static HEADER_SIZE: number = 3;
  /** The offset from the header where the delete count is stored. */
  static #DELETES = 2;

  /**
   * In addition to the item fields defined by `SharedTypeMap`,
   * each edge includes another 6 4-byte chunks:
   *
   * struct Edge {
   *   int next; // from `SharedTypeMap`
   *   int type; // from `SharedTypeMap`
   *   int from;
   *   int to;
   *   int nextIn;
   *   int prevIn;
   *   int nextOut;
   *   int prevOut;
   * }
   *
   * ┌──────┬──────┬──────┬────┬─────────┬─────────┬──────────┬──────────┐
   * │ NEXT │ TYPE │ FROM │ TO │ NEXT_IN │ PREV_IN │ NEXT_OUT │ PREV_OUT │
   * └──────┴──────┴──────┴────┴─────────┴─────────┴──────────┴──────────┘
   *
   * The `Edge` implicitly maps an edge hash (the hash of the edge's `FROM`,
   * `TO`, and `TYPE` values) to the next and previous adjacent edges of the
   * same _edge type_.
   */
  static ITEM_SIZE: number = 8;
  /** The offset at which an edge's 'from' node id is stored. */
  static #FROM = 2;
  /** The offset at which an edge's 'to' node id is stored. */
  static #TO = 3;
  /** The offset at which the 'to' node's next incoming edge is stored.  */
  static #NEXT_IN = 4;
  /** The offset at which the 'to' node's previous incoming edge is stored.  */
  static #PREV_IN = 5;
  /** The offset at which the 'from' node's next outgoing edge is stored.  */
  static #NEXT_OUT = 6;
  /** The offset at which the 'from' node's previous outgoing edge is stored.  */
  static #PREV_OUT = 7;

  /** The number of deleted edges currently occupying space in the map. */
  get deletes(): number {
    return this.data[EdgeTypeMap.#DELETES];
  }

  /** Get the next available address in the map. */
  getNextAddress(): EdgeAddress {
    let {ITEM_SIZE} = this.constructor;
    return this.addressableLimit + (this.count + this.deletes) * ITEM_SIZE;
  }

  /**
   * Add an edge of the given `type` between the `to` and `from` nodes
   * and link the address to the `hash` bucket.
   */
  add(hash: EdgeHash, from: NodeId, to: NodeId, type: TEdgeType): EdgeAddress {
    assert(
      hash >= 0 && hash < this.capacity,
      `Invalid edge hash ${String(hash)}`,
    );
    // Use the next available edge address.
    let edge = this.getNextAddress();
    // Add our new edge to its hash bucket.
    this.link(hash, edge, type);
    this.data[edge + EdgeTypeMap.#FROM] = fromNodeId(from);
    this.data[edge + EdgeTypeMap.#TO] = fromNodeId(to);
    return edge;
  }

  /**
   * Remove the `to` and `from` nodes for the given `edge` address
   * and increment the `deletes` counter.
   */
  delete(edge: EdgeAddress): void {
    this.data[edge + EdgeTypeMap.#FROM] = 0;
    this.data[edge + EdgeTypeMap.#TO] = 0;
    this.data[EdgeTypeMap.#DELETES]++;
  }

  /**
   * Get the address of the edge with the given `hash`, `from` and `to` nodes,
   * and edge `type`.
   */
  addressOf(
    hash: EdgeHash,
    from: NodeId,
    to: NodeId,
    type: TEdgeType,
  ): EdgeAddress | null {
    let address = this.head(hash);
    while (address !== null) {
      if (
        this.typeOf(address) === type &&
        this.from(address) === from &&
        this.to(address) === to
      ) {
        return address;
      }
      address = this.next(address);
    }
    return null;
  }

  /** Get the id of the 'from' node for the given `edge` address. */
  from(edge: EdgeAddress): NodeId {
    return toNodeId(this.data[edge + EdgeTypeMap.#FROM]);
  }

  /** Get the id of the 'to' node for the given `edge` address. */
  to(edge: EdgeAddress): NodeId {
    return toNodeId(this.data[edge + EdgeTypeMap.#TO]);
  }

  /**
   * Get the address of the next edge _of the same type_
   * incoming _to the same node_ as the edge at the given address.
   */
  nextIn(edge: EdgeAddress): EdgeAddress | null {
    return this.data[edge + EdgeTypeMap.#NEXT_IN] || null;
  }

  /**
   * Get the address of the previous edge _of the same type_
   * incoming _to the same node_ as the edge at the given address.
   */
  prevIn(edge: EdgeAddress): EdgeAddress | null {
    return this.data[edge + EdgeTypeMap.#PREV_IN] || null;
  }

  /** Link two adjacent edges of the same type incoming to the same node. */
  linkIn(edge: EdgeAddress, next: EdgeAddress) {
    assert(this.typeOf(edge) === this.typeOf(next), 'Edge types must match.');
    assert(this.to(edge) === this.to(next), 'To nodes must match.');
    this.data[edge + EdgeTypeMap.#NEXT_IN] = next;
    this.data[next + EdgeTypeMap.#PREV_IN] = edge;
  }

  /**
   * Unlink an edge from the doubly linked list of incoming edges
   * to the same node.
   */
  unlinkIn(edge: EdgeAddress) {
    let next = this.nextIn(edge);
    let prev = this.prevIn(edge);
    this.data[edge + EdgeTypeMap.#NEXT_IN] = 0;
    this.data[edge + EdgeTypeMap.#PREV_IN] = 0;
    if (next !== null && prev !== null) {
      this.data[prev + EdgeTypeMap.#NEXT_IN] = next;
      this.data[next + EdgeTypeMap.#PREV_IN] = prev;
    } else if (next !== null) {
      this.data[next + EdgeTypeMap.#PREV_IN] = 0;
    } else if (prev !== null) {
      this.data[prev + EdgeTypeMap.#NEXT_IN] = 0;
    }
  }

  /**
   * Get the address of the next edge _of the same type_
   * outgoing _from the same node_ as the edge at the given address.
   */
  nextOut(edge: EdgeAddress): EdgeAddress | null {
    return this.data[edge + EdgeTypeMap.#NEXT_OUT] || null;
  }

  /**
   * Get the address of the previous edge _of the same type_
   * outgoing _from the same node_ as the edge at the given address.
   */
  prevOut(edge: EdgeAddress): EdgeAddress | null {
    return this.data[edge + EdgeTypeMap.#PREV_OUT] || null;
  }

  /** Link two adjacent edges of the same type outgoing from the same node. */
  linkOut(edge: EdgeAddress, next: EdgeAddress) {
    assert(this.typeOf(edge) === this.typeOf(next), 'Edge types must match.');
    assert(this.from(edge) === this.from(next), 'From nodes must match.');
    this.data[edge + EdgeTypeMap.#NEXT_OUT] = next;
    this.data[next + EdgeTypeMap.#PREV_OUT] = edge;
  }

  /**
   * Unlink an edge from the doubly linked list of outgoing edges
   * of the same type from the same node.
   */
  unlinkOut(edge: EdgeAddress) {
    let next = this.nextOut(edge);
    let prev = this.prevOut(edge);
    this.data[edge + EdgeTypeMap.#NEXT_OUT] = 0;
    this.data[edge + EdgeTypeMap.#PREV_OUT] = 0;
    if (next !== null && prev !== null) {
      this.data[prev + EdgeTypeMap.#NEXT_OUT] = next;
      this.data[next + EdgeTypeMap.#PREV_OUT] = prev;
    } else if (next !== null) {
      this.data[next + EdgeTypeMap.#PREV_OUT] = 0;
    } else if (prev !== null) {
      this.data[prev + EdgeTypeMap.#NEXT_OUT] = 0;
    }
  }

  /** Create a hash of the edge connecting the `from` and `to` nodes.  */
  hash(from: NodeId, to: NodeId, type: TEdgeType): EdgeHash {
    // Each parameter is hashed by mixing its upper bits into its lower bits to
    // increase the likelihood that a change to any bit of the input will vary
    // the output widely. Then we do a series of prime multiplications and
    // additions to combine the hashes into one value.
    let hash = 17;
    hash = hash * 37 + hash32shift((from: any));
    hash = hash * 37 + hash32shift((to: any));
    hash = hash * 37 + hash32shift((type: any));
    // Finally, we map the hash to a value modulo the edge capacity.
    hash %= this.capacity;
    return hash;
  }
}

/**
 * Links a node to another node with an edge of the given type.
 *
 * Returns one of the following numeric status codes:
 * - `0` EdgeAdded: the edge was added
 * - `1` EdgeExists: the edge already exists
 * - `2` EdgesOverloaded: the edge map is overloaded
 * - `3` TooManyDeletes: the edge map has too many deleted edges
 * - `4` NodesOverloaded: the node map is overloaded
 */
function link<TEdgeType: number>(
  from: NodeId,
  to: NodeId,
  type: TEdgeType | NullEdgeType,
  edges: EdgeTypeMap<TEdgeType | NullEdgeType>,
  nodes: NodeTypeMap<TEdgeType | NullEdgeType>,
  unloadFactor: number = DEFAULT_PARAMS.unloadFactor,
): $Values<typeof LinkResult> {
  let hash = edges.hash(from, to, type);
  let edge = edges.addressOf(hash, from, to, type);

  // The edge is already in the graph; do nothing.
  if (edge !== null) return LinkResult.EdgeExists;

  let toNode = nodes.addressOf(to, type);
  let fromNode = nodes.addressOf(from, type);

  let nodeCount = nodes.count;
  // add one for each node we must add.
  if (toNode === null) nodeCount++;
  if (fromNode === null) nodeCount++;
  // If we're in danger of overflowing the `nodes` array, resize it.
  if (nodes.getLoad(nodeCount) >= 1) {
    return LinkResult.NodesOverloaded;
  }

  // We add 1 to account for the edge we are adding.
  let count = edges.count + 1;
  // Since the space occupied by deleted edges isn't reclaimed,
  // we include them in our count to avoid overflowing the `edges` array.
  let deletes = edges.deletes;
  let total = count + deletes;
  if (edges.getLoad(total) >= 1) {
    if (
      edges.getLoad(deletes) >= unloadFactor &&
      edges.getLoad(count) < unloadFactor
    ) {
      // If we have a significant number of deletes, reclaim the space.
      return LinkResult.TooManyDeletes;
    } else {
      return LinkResult.EdgesOverloaded;
    }
  }

  if (toNode === null) toNode = nodes.add(to, type);
  if (fromNode === null) fromNode = nodes.add(from, type);

  // Add our new edge to its hash bucket.
  edge = edges.add(hash, from, to, type);

  // Link this edge to the node's list of incoming edges.
  let prevIn = nodes.linkIn(toNode, edge);
  if (prevIn !== null) edges.linkIn(prevIn, edge);

  // Link this edge to the node's list of outgoing edges.
  let prevOut = nodes.linkOut(fromNode, edge);
  if (prevOut !== null) edges.linkOut(prevOut, edge);

  return LinkResult.EdgeAdded;
}

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

function interpolate(x: number, y: number, t: number): number {
  return x + (y - x) * Math.min(1, Math.max(0, t));
}

function increaseNodeCapacity(
  currentCapacity: number,
  params: AdjacencyListParams,
): number {
  let newCapacity = Math.max(
    // Make sure we have room for at least 2 more nodes.
    currentCapacity + 2,
    Math.ceil(currentCapacity * params.minGrowFactor),
  );

  if (newCapacity >= NodeTypeMap.MAX_CAPACITY) {
    if (currentCapacity > NodeTypeMap.MAX_CAPACITY - 2) {
      throw new Error('Node capacity overflow!');
    }

    return NodeTypeMap.MAX_CAPACITY;
  }

  return newCapacity;
}

function increaseEdgeCapacity(
  currentCapacity: number,
  params: AdjacencyListParams,
): number {
  // This is intended to strike a balance between growing the edge capacity
  // in too small increments, which causes a lot of resizing, and growing
  // the edge capacity in too large increments, which results in a lot of
  // wasted memory.
  let pct = currentCapacity / params.peakCapacity;
  let growFactor = interpolate(params.maxGrowFactor, params.minGrowFactor, pct);

  let newCapacity = Math.max(
    // Make sure we have room for at least one more edge.
    currentCapacity + 1,
    Math.ceil(currentCapacity * growFactor),
  );

  if (newCapacity >= EdgeTypeMap.MAX_CAPACITY) {
    if (currentCapacity > EdgeTypeMap.MAX_CAPACITY - 1) {
      throw new Error('Edge capacity overflow!');
    }

    return EdgeTypeMap.MAX_CAPACITY;
  }

  return newCapacity;
}

function decreaseEdgeCapacity(
  currentCapacity: number,
  params: AdjacencyListParams,
): number {
  return Math.max(
    // Make sure we don't shrink the capacity _below_ 2.
    2,
    Math.min(
      // Make sure we shrink the capacity by at least 1.
      currentCapacity - 1,
      Math.ceil(currentCapacity * params.shrinkFactor),
    ),
  );
}
