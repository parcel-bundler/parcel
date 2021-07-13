// @flow
import {digraph} from 'graphviz';
import {spawn} from 'child_process';
import {inspect} from 'util';
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

function deletedThrows<TEdgeType>(type: TEdgeType): TEdgeType {
  if (isDeleted(type)) throw new Error('Edge was deleted!');
  return type;
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

/** A view of the Node data stored in the `AdjacencyList` at a given index.  */
export class Node<TEdgeType: number = 1> {
  +index: number;
  +graph: AdjacencyList<TEdgeType>;

  constructor() {
    throw new Error('use Node.at() or Node.fromId()');
  }

  static fromId(id: NodeId, graph: AdjacencyList<TEdgeType>): Node<TEdgeType> {
    let index = indexOfNode(id);
    assert(
      index >= 0 && index <= graph.nodes.length - NODE_SIZE,
      `${index} is outside of the range (0, ${graph.nodes.length -
        NODE_SIZE}).`,
    );
    // TODO: Pool these objects so we don't create so many?
    let node = Object.create(Node.prototype, {
      index: {value: index, writable: false, configurable: true},
      graph: {value: graph, writable: false, configurable: true},
    });
    return node;
  }

  static at(index: number, graph: AdjacencyList<TEdgeType>): Node<TEdgeType> {
    return Node.fromId(nodeAt(index), graph);
  }

  /** Iterate over all of the node data in the `AdjacencyList`. */
  static *iterate(
    graph: AdjacencyList<TEdgeType>,
    max: number = graph.numNodes,
  ): Iterator<Node<TEdgeType>> {
    let count = 0;
    for (let i = 0; i < graph.nodes.length; i += NODE_SIZE) {
      if (count++ >= max) break;
      yield Node.at(i, graph);
    }
  }

  get id(): NodeId {
    return nodeAt(this.index);
  }

  /** Gets or sets the first outgoing edge from this node. */
  get firstOutgoingEdge(): Edge<TEdgeType> | null {
    let hash = this.graph.nodes[this.index + FIRST_OUT];
    return hash ? Edge.fromHash(hash, this.graph) : null;
  }
  set firstOutgoingEdge(edge: Edge<TEdgeType> | null) {
    if (edge) {
      assert(
        edge.from.id === this.id,
        `Cannot link edge from ${String(edge.from.id)} to node ${String(
          this.id,
        )}.`,
      );
    }
    this.graph.nodes[this.index + FIRST_OUT] = edge?.hash ?? 0;
  }

  /** Gets or sets the last outgoing edge from this node. */
  get lastOutgoingEdge(): Edge<TEdgeType> | null {
    let hash = this.graph.nodes[this.index + LAST_OUT];
    return hash ? Edge.fromHash(hash, this.graph) : null;
  }
  set lastOutgoingEdge(edge: Edge<TEdgeType> | null) {
    if (edge) {
      assert(
        edge.from.id === this.id,
        `Cannot link edge from ${String(edge.from.id)} to node ${String(
          this.id,
        )}.`,
      );
    }
    this.graph.nodes[this.index + LAST_OUT] = edge?.hash ?? 0;
  }

  /** Gets or sets the first incoming edge to this node. */
  get firstIncomingEdge(): Edge<TEdgeType> | null {
    let hash = this.graph.nodes[this.index + FIRST_IN];
    return hash ? Edge.fromHash(hash, this.graph) : null;
  }
  set firstIncomingEdge(edge: Edge<TEdgeType> | null) {
    if (edge) {
      assert(
        edge.to.id === this.id,
        `Cannot link edge to ${String(edge.to.id)} to node ${String(this.id)}.`,
      );
    }
    this.graph.nodes[this.index + FIRST_IN] = edge?.hash ?? 0;
  }

  /** Gets or sets the last incoming edge to this node. */
  get lastIncomingEdge(): Edge<TEdgeType> | null {
    let hash = this.graph.nodes[this.index + LAST_IN];
    return hash ? Edge.fromHash(hash, this.graph) : null;
  }
  set lastIncomingEdge(edge: Edge<TEdgeType> | null) {
    if (edge) {
      assert(
        edge.to.id === this.id,
        `Cannot link edge to ${String(edge.to.id)} to node ${String(this.id)}.`,
      );
    }
    this.graph.nodes[this.index + LAST_IN] = edge?.hash ?? 0;
  }

  /** Gets all incoming edges to this node. */
  *getIncomingEdges(): Iterator<Edge<TEdgeType>> {
    let start = this.firstIncomingEdge;
    if (start) yield* this._iterateEdges(NEXT_IN, start);
  }

  /** Gets all incoming edges to this node, starting from the last incoming edge. */
  *getIncomingEdgesReverse(): Iterator<Edge<TEdgeType>> {
    let start = this.lastIncomingEdge;
    if (start) yield* this._iterateEdges(PREV_IN, start);
  }

  /** Gets all outgoing edges to this node. */
  *getOutgoingEdges(): Iterator<Edge<TEdgeType>> {
    let start = this.firstOutgoingEdge;
    if (start) yield* this._iterateEdges(NEXT_OUT, start);
  }

  /** Gets all outgoing edges to this node, starting from the last outgoing edge. */
  *getOutgoingEdgesReverse(): Iterator<Edge<TEdgeType>> {
    let start = this.lastOutgoingEdge;
    if (start) yield* this._iterateEdges(PREV_OUT, start);
  }

  *_iterateEdges(
    direction:
      | typeof PREV_IN
      | typeof PREV_OUT
      | typeof NEXT_IN
      | typeof NEXT_OUT,
    edge: Edge<TEdgeType>,
  ): Iterator<Edge<TEdgeType>> {
    let value = edge;
    while (value) {
      yield value;
      let nextHash = this.graph.edges[value.index + direction];
      if (!nextHash) break;
      value = Edge.fromHash(nextHash, this.graph);
    }
  }

  toJSON(): {|
    id: number,
    firstIncomingEdge: number | null,
    firstOutgoingEdge: number | null,
    lastIncomingEdge: number | null,
    lastoutgoingEdge: number | null,
  |} {
    return JSON.parse(
      JSON.stringify({
        id: this.id,
        firstIncomingEdge: this.firstIncomingEdge?.hash ?? null,
        firstOutgoingEdge: this.firstOutgoingEdge?.hash ?? null,
        lastIncomingEdge: this.lastIncomingEdge?.hash ?? null,
        lastOutgoingEdge: this.lastOutgoingEdge?.hash ?? null,
      }),
    );
  }

  toString(): string {
    return `Node [${fromNodeId(this.id)}]`;
  }

  valueOf(): NodeId {
    return this.id;
  }

  // $FlowFixMe[unsupported-syntax]
  [inspect.custom](_, opts) {
    return opts.stylize(this.toString());
  }

  // $FlowFixMe[unsupported-syntax]
  get [Symbol.toStringTag]() {
    return String(this.id);
  }
}

/** A view of the Edge data stored in the `AdjacencyList` at a given `index`. */
export class Edge<TEdgeType: number = 1> {
  +index: number;
  +graph: AdjacencyList<TEdgeType>;

  constructor() {
    throw new Error('Use Edge.at(), Edge.fromHash(), or Edge.insertAt()');
  }

  static fromHash(
    hash: EdgeHash,
    graph: AdjacencyList<TEdgeType>,
  ): Edge<TEdgeType> {
    let index = hashToIndex(hash);
    assert(
      index >= 0 && index <= graph.edges.length - EDGE_SIZE,
      `${index} is outside of the range (0, ${graph.edges.length -
        EDGE_SIZE}).`,
    );
    // TODO: Pool these objects so we don't create so many?
    let edge = Object.create(Edge.prototype, {
      index: {value: index, writable: false, configurable: true},
      graph: {value: graph, writable: false, configurable: true},
    });
    return edge;
  }

  static at(index: number, graph: AdjacencyList<TEdgeType>): Edge<TEdgeType> {
    return Edge.fromHash(indexToHash(index), graph);
  }

  static insertAt(
    index: number,
    from: NodeId,
    to: NodeId,
    type: TEdgeType,
    graph: AdjacencyList<TEdgeType>,
  ): Edge<TEdgeType> {
    graph.edges[index + TYPE] = type;
    graph.edges[index + FROM] = fromNodeId(from);
    graph.edges[index + TO] = fromNodeId(to);
    return Edge.at(index, graph);
  }

  static deleteAt(index: number, graph: AdjacencyList<TEdgeType>) {
    // Mark this slot as DELETED.
    // We do this so that clustered edges can still be found
    // by scanning forward in the array from the first index for
    // the cluster.
    graph.edges[index + TYPE] = DELETED;
    graph.edges[index + FROM] = 0;
    graph.edges[index + TO] = 0;
    graph.edges[index + PREV_IN] = 0;
    graph.edges[index + PREV_OUT] = 0;
    graph.edges[index + NEXT_IN] = 0;
    graph.edges[index + NEXT_OUT] = 0;
  }

  get hash(): EdgeHash {
    return indexToHash(this.index);
  }

  get index(): number {
    return this.index;
  }

  get type(): TEdgeType {
    return (this.graph.edges[this.index + TYPE]: any);
  }

  get from(): Node<TEdgeType> {
    return Node.fromId(
      toNodeId(this.graph.edges[this.index + FROM]),
      this.graph,
    );
  }

  get to(): Node<TEdgeType> {
    return Node.fromId(toNodeId(this.graph.edges[this.index + TO]), this.graph);
  }

  get isDeleted(): boolean {
    return isDeleted(this.type);
  }

  get nextIncomingEdge(): Edge<TEdgeType> | null {
    return this._findEdgeAfter(NEXT_IN);
  }
  set nextIncomingEdge(edge: Edge<TEdgeType> | null) {
    let nextHash = edge?.hash ?? 0;
    this.graph.edges[this.index + NEXT_IN] = nextHash;
  }

  get previousIncomingEdge(): Edge<TEdgeType> | null {
    return this._findEdgeBefore(PREV_IN);
  }
  set previousIncomingEdge(edge: Edge<TEdgeType> | null) {
    let prevHash = edge?.hash ?? 0;
    this.graph.edges[this.index + PREV_IN] = prevHash;
  }

  get nextOutgoingEdge(): Edge<TEdgeType> | null {
    return this._findEdgeAfter(NEXT_OUT);
  }
  set nextOutgoingEdge(edge: Edge<TEdgeType> | null) {
    let nextHash = edge?.hash ?? 0;
    this.graph.edges[this.index + NEXT_OUT] = nextHash;
  }

  get previousOutgoingEdge(): Edge<TEdgeType> | null {
    return this._findEdgeBefore(PREV_OUT);
  }
  set previousOutgoingEdge(edge: Edge<TEdgeType> | null) {
    let prevHash = edge?.hash ?? 0;
    this.graph.edges[this.index + PREV_OUT] = prevHash;
  }

  _findEdgeBefore(
    direction: typeof PREV_IN | typeof PREV_OUT,
  ): Edge<TEdgeType> | null {
    let prevHash = this.graph.edges[this.index + direction];
    return prevHash ? Edge.fromHash(prevHash, this.graph) : null;
  }

  _findEdgeAfter(
    direction: typeof NEXT_IN | typeof NEXT_OUT,
  ): Edge<TEdgeType> | null {
    let nextHash = this.graph.edges[this.index + direction];
    return nextHash ? Edge.fromHash(nextHash, this.graph) : null;
  }

  toJSON(): {|
    hash: number,
    from: number,
    to: number,
    type: number,
    nextIncomingEdge: number | null,
    nextOutgoingEdge: number | null,
    previousIncomingEdge: number | null,
    previousOutgoingEdge: number | null,
  |} {
    const {
      hash,
      from,
      to,
      type,
      nextIncomingEdge,
      previousIncomingEdge,
      nextOutgoingEdge,
      previousOutgoingEdge,
    } = this;
    return JSON.parse(
      JSON.stringify({
        hash,
        type,
        from,
        to,
        nextIncomingEdge: nextIncomingEdge?.hash ?? null,
        previousIncomingEdge: previousIncomingEdge?.hash ?? null,
        nextOutgoingEdge: nextOutgoingEdge?.hash ?? null,
        previousOutgoingEdge: previousOutgoingEdge?.hash ?? null,
      }),
    );
  }

  toString(): string {
    const {hash, from, to, type} = this;
    return `Edge [${hash}] (${type}) { ${[from, '=>', to].join(' ')} }`;
  }

  valueOf(): EdgeHash {
    return this.hash;
  }

  // $FlowFixMe[unsupported-syntax]
  [inspect.custom](_, opts) {
    return opts.stylize(this.toString());
  }

  // $FlowFixMe[unsupported-syntax]
  get [Symbol.toStringTag]() {
    return String(this.hash);
  }
}

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
    /** The number of edge hash collisions. */
    collisions: number,
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

    let collisions = 0;
    let distribution = 0;

    for (let bucket of buckets.values()) {
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
      uniformity,
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
    for (let from of Node.iterate(this)) {
      for (let edge of from.getOutgoingEdges()) {
        copy.addEdge(edge.from.id, edge.to.id, edge.type);
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
    for (let node of Node.iterate(this)) {
      for (let edge of node.getOutgoingEdges()) {
        this.fromTypeMap
          .get(node.id)
          .get(edge.type)
          .add(edge.to.id);
        this.toTypeMap
          .get(edge.to.id)
          .get(edge.type)
          .add(node.id);
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

    let edge = Edge.insertAt(index, from, to, (type: any), this);

    this.fromTypeMap
      ?.get(from)
      .get(type)
      .add(to);

    this.toTypeMap
      ?.get(to)
      .get(type)
      .add(from);

    if (edge.to.lastIncomingEdge) {
      edge.to.lastIncomingEdge.nextIncomingEdge = edge;
      edge.previousIncomingEdge = edge.to.lastIncomingEdge;
    }
    edge.to.lastIncomingEdge = edge;
    if (!edge.to.firstIncomingEdge) {
      edge.to.firstIncomingEdge = edge;
    }
    if (edge.from.lastOutgoingEdge) {
      edge.from.lastOutgoingEdge.nextOutgoingEdge = edge;
      edge.previousOutgoingEdge = edge.from.lastOutgoingEdge;
    }
    edge.from.lastOutgoingEdge = edge;
    if (!edge.from.firstOutgoingEdge) {
      edge.from.firstOutgoingEdge = edge;
    }

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
    if (!this.toTypeMap || !this.fromTypeMap) this.buildTypeMaps();
    for (let [from, toTypeMap] of this.fromTypeMap) {
      for (let [type, toNodes] of toTypeMap) {
        for (let to of toNodes) {
          yield {type: (type: any), from, to};
        }
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

    let edge = Edge.at(index, this);
    // If the edge's `to` node references this edge as
    // its first incoming edge, update it to the next incoming edge.
    if (edge.to.firstIncomingEdge?.hash === edge.hash) {
      edge.to.firstIncomingEdge = edge.nextIncomingEdge;
    }
    // If the edge's `to` node references this edge as
    // its last incoming edge, update it to the previous incoming edge.
    if (edge.to.lastIncomingEdge?.hash === edge.hash) {
      edge.to.lastIncomingEdge = edge.previousIncomingEdge;
    }
    // If the edge's `from` node references this edge as
    // its first outgoing edge, update it to the previous outgoing edge.
    if (edge.from.firstOutgoingEdge?.hash === edge.hash) {
      edge.from.firstOutgoingEdge = edge.nextOutgoingEdge;
    }
    // If the edge's `from` node references this edge as
    // its last outgoing edge, update it to the previous outgoing edge.
    if (edge.from.lastOutgoingEdge?.hash === edge.hash) {
      edge.from.lastOutgoingEdge = edge.previousOutgoingEdge;
    }
    // Splice this edge from the `from` node's list of outgoing edges.
    if (edge.previousOutgoingEdge) {
      edge.previousOutgoingEdge.nextOutgoingEdge = edge.nextOutgoingEdge;
    }
    // Splice this edge from the `to` node's list of incoming edges.
    if (edge.previousIncomingEdge) {
      edge.previousIncomingEdge.nextIncomingEdge = edge.nextIncomingEdge;
    }
    // Splice this edge from the `from` node's list of outgoing edges.
    if (edge.nextOutgoingEdge) {
      edge.nextOutgoingEdge.previousOutgoingEdge = edge.previousOutgoingEdge;
    }
    // Splice this edge from the `to` node's list of incoming edges.
    if (edge.nextIncomingEdge) {
      edge.nextIncomingEdge.previousIncomingEdge = edge.previousIncomingEdge;
    }

    this.fromTypeMap
      ?.get(from)
      .get(type)
      .delete(to);

    this.toTypeMap
      ?.get(to)
      .get(type)
      .delete(from);

    // Mark this space in the edges array as deleted.
    Edge.deleteAt(index, this);

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
