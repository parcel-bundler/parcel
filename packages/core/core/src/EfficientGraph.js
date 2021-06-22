// @flow
import {fromNodeId, toNodeId} from './types';
import type {NodeId} from './types';
import {digraph} from 'graphviz';
import {spawn} from 'child_process';
import type {NullEdgeType, AllEdgeTypes} from './Graph';

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
 */
export const EDGE_SIZE = 5;

/** The offset from an edge index at which the edge type is stored. */
const TYPE: 0 = 0;
/** The offset from an edge index at which the 'from' node id is stored. */
const FROM: 1 = 1;
/** The offset from an edge index at which the 'to' node id is stored. */
const TO: 2 = 2;
/** The offset from an edge index at which the hash of the 'to' node's next incoming edge is stored. */
const NEXT_IN: 3 = 3;
/** The offset from an edge index at which the hash of the 'from' node's next incoming edge is stored. */
const NEXT_OUT: 4 = 4;

/** The offset from a node index at which the hash of the first incoming edge is stored. */
const FIRST_IN: 0 = 0;
/** The offset from a node index at which the hash of the first outgoing edge is stored. */
const FIRST_OUT: 1 = 1;

/**
 * A sentinel that indicates that an edge was deleted.
 *
 * Because our (open-addressed) table resolves hash collisions
 * by scanning forward for the next open slot when inserting,
 * and stops scanning at the next open slot when fetching,
 * we use this sentinel (instead of `0`) to maintain contiguity.
 */
const DELETED: 0xffffffff = 0xffffffff;

const isDeleted = (type: number): boolean => type === DELETED;

const deletedThrows = (type: number): number => {
  if (isDeleted(type)) throw new Error('Edge was deleted!');
  return type;
};

export const ALL_EDGE_TYPES: AllEdgeTypes = '@@all_edge_types';

export type SerializedEfficientGraph<TEdgeType> = {|
  nodes: Uint32Array,
  edges: Uint32Array,
  numNodes: number,
  numEdges: number,
  edgeCapacity: number,
  nodeCapacity: number,
|};

type EdgeAttr =
  | typeof TYPE
  | typeof FROM
  | typeof TO
  | typeof NEXT_IN
  | typeof NEXT_OUT;

type Edge<TEdgeType> = {|
  from: NodeId,
  to: NodeId,
  type: TEdgeType,
|};

type NodeAttr = typeof FIRST_IN | typeof FIRST_OUT;

opaque type EdgeHash = number;
/** Get the hash of the edge at the given index in the edges array. */
const indexToHash = (index: number): EdgeHash => index + 1;
/** Get the index in the edges array of the given edge. */
const hashToIndex = (hash: EdgeHash) => Math.max(0, hash - 1);

opaque type EdgeType = number;
/** remove these for now in favor of preventing 0 edge types in Graph */
/** `1` is added to the type to allow a type value of `0`. */
// const fromEdgeType = (type: EdgeType): number => type + 1;
// const toEdgeType = (id: number) => Math.max(0, id - 1);

/** Get the id of the node at the given index in the nodes array. */
const nodeAt = (index: number): NodeId =>
  toNodeId((index - (index % NODE_SIZE)) / NODE_SIZE);
/** Get the index in the nodes array of the given node. */
const indexOfNode = (id: NodeId): number => fromNodeId(id) * NODE_SIZE;

export default class EfficientGraph<TEdgeType: number = 1> {
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
  }

  /**
   * Create a new `EfficientGraph` from the given options.
   *
   * The options should match the format returned by the `serialize` method.
   */
  static deserialize(
    opts: SerializedEfficientGraph<TEdgeType>,
  ): EfficientGraph<TEdgeType> {
    let res = Object.create(EfficientGraph.prototype);
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
  serialize(): SerializedEfficientGraph<TEdgeType> {
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
    let {numNodes, nodes, nodeCapacity, numEdges, edges, edgeCapacity} = this;
    let buckets = new Map();
    for (let i = 0; i < nodes.length; i += NODE_SIZE) {
      let from = nodeAt(i);
      for (
        let hash = nodes[i + FIRST_OUT];
        hash;
        hash = edges[hashToIndex(hash) + NEXT_OUT]
      ) {
        let to = toNodeId(edges[hashToIndex(hash) + TO]);
        let type = (edges[hashToIndex(hash) + TYPE]: any);
        let bucketHash = this.hash(from, to, type);
        let bucket = buckets.get(bucketHash) || new Set();
        bucket.add(`${fromNodeId(from)}, ${fromNodeId(to)}, ${type}`);
        buckets.set(bucketHash, bucket);
      }
      let to = from;
      for (
        let hash = nodes[i + FIRST_IN];
        hash;
        hash = edges[hashToIndex(hash) + NEXT_IN]
      ) {
        let from = toNodeId(edges[hashToIndex(hash) + FROM]);
        let type = (edges[hashToIndex(hash) + TYPE]: any);
        let bucketHash = this.hash(from, to, type);
        let bucket = buckets.get(bucketHash) || new Set();
        bucket.add(`${fromNodeId(from)}, ${fromNodeId(to)}, ${type}`);
        buckets.set(bucketHash, bucket);
      }
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
    /** The edge list to be copied to the resized list. */
    let edges = this.edges;
    // Allocate the required space for an `edges` array of the given `size`.
    this.edges = new Uint32Array(size * EDGE_SIZE);
    this.edgeCapacity = size;
    this.copyEdges(edges);
  }

  /**
   * Copy the edges in the given array into the internal edges array.
   */
  copyEdges(edges: Uint32Array) {
    // For each node in the graph, copy the existing edges into the new array.
    for (let i = 0; i < this.nodes.length; i += NODE_SIZE) {
      /** The next node with edges to copy. */
      let from = nodeAt(i);
      /** The last edge copied. */
      let lastIndex = null;
      for (
        /** The next outgoing edge to be copied. */
        let hash = this.nodes[i + FIRST_OUT];
        hash;
        hash = edges[hashToIndex(hash) + NEXT_OUT]
      ) {
        /** The node that the next outgoing edge connects to. */
        let to = toNodeId(edges[hashToIndex(hash) + TO]);
        let type = (edges[hashToIndex(hash) + TYPE]: any);
        /** The index at which to copy this edge. */
        let index = this.indexFor(from, to, type);
        if (index === -1) {
          // Edge already copied?
          index = this.indexOf(from, to, type);
        } else {
          // Copy the details of the edge into the new edge list.
          this.edges[index + TYPE] = type;
          this.edges[index + FROM] = fromNodeId(from);
          this.edges[index + TO] = fromNodeId(to);
        }

        if (lastIndex != null) {
          // If this edge is not the first outgoing edge from the current node,
          // link this edge to the last outgoing edge copied.
          this.edges[lastIndex + NEXT_OUT] = indexToHash(index);
        } else {
          // If this edge is the first outgoing edge from the current node,
          // link this edge to the current node.
          this.nodes[i + FIRST_OUT] = indexToHash(index);
        }
        // Keep track of the last outgoing edge copied.
        lastIndex = index;
      }

      // Reset lastIndex for use while copying incoming edges.
      lastIndex = undefined;

      // Now we're copying incoming edges, so `from` becomes `to`.
      let to = from;
      for (
        /** The next incoming edge to be copied. */
        let hash = this.nodes[i + FIRST_IN];
        hash;
        hash = edges[hashToIndex(hash) + NEXT_IN]
      ) {
        /** The node that the next incoming edge connects from. */
        let from = toNodeId(edges[hashToIndex(hash) + FROM]);
        let type = (edges[hashToIndex(hash) + TYPE]: any);
        /** The index at which to copy this edge. */
        let index = this.indexFor(from, to, type);
        if (index === -1) {
          // Edge already copied?
          index = this.indexOf(from, to, type);
        } else {
          // Copy the details of the edge into the new edge list.
          this.edges[index + TYPE] = type;
          this.edges[index + FROM] = fromNodeId(from);
          this.edges[index + TO] = fromNodeId(to);
        }
        if (lastIndex != null) {
          // If this edge is not the first incoming edge to the current node,
          // link this edge to the last incoming edge copied.
          this.edges[lastIndex + NEXT_IN] = indexToHash(index);
        } else {
          // If this edge is the first incoming edge from the current node,
          // link this edge to the current node.
          this.nodes[i + FIRST_IN] = indexToHash(index);
        }

        // Keep track of the last edge copied.
        lastIndex = index;
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
    if (from < 0 || from >= this.numNodes)
      throw new Error(`Unknown node ${from}`);
    if (to < 0 || to >= this.numNodes) throw new Error(`Unknown node ${to}`);
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

    // Each edge takes up `EDGE_SIZE` space in the `edges` array.
    // `[type, from, to, nextIncoming, nextOutgoing]`
    this.edges[index + TYPE] = type;
    this.edges[index + FROM] = fromNodeId(from);
    this.edges[index + TO] = fromNodeId(to);

    // Set this edge as the first incoming edge on the `to` node,
    // Unless it already has a first incoming edge.
    // In that case, append this edge as the next incoming edge
    // after the last incoming edge to have been added.
    let nextIn = this.nodes[indexOfNode(to) + FIRST_IN];
    if (nextIn) {
      let nextInIndex = hashToIndex(nextIn);
      for (let i = nextInIndex; i; i = hashToIndex(this.edges[i + NEXT_IN])) {
        nextInIndex = i;
      }
      this.edges[nextInIndex + NEXT_IN] = indexToHash(index);
    } else {
      // We store the hash of this edge as the `to` node's incoming edge.
      this.nodes[indexOfNode(to) + FIRST_IN] = indexToHash(index);
    }

    // Set this edge as the first outgoing edge on the `from` node,
    // Unless it already has a first outgoing edge.
    // In that case, append this edge as the next outgoing edge
    // after the last outgoing edge to have been added.
    let nextOut = this.nodes[indexOfNode(from) + FIRST_OUT];
    if (nextOut) {
      let nextOutIndex = hashToIndex(nextOut);
      for (let i = nextOutIndex; i; i = hashToIndex(this.edges[i + NEXT_OUT])) {
        nextOutIndex = i;
      }
      this.edges[nextOutIndex + NEXT_OUT] = indexToHash(index);
    } else {
      this.nodes[indexOfNode(from) + FIRST_OUT] = indexToHash(index);
    }

    return true;
  }

  /**
   * Get the index of the edge connecting the `from` and `to` nodes.
   *
   * If an edge connecting `from` and `to` does not exist, returns `-1`.
   */
  indexOf(from: NodeId, to: NodeId, type: TEdgeType | NullEdgeType): number {
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
  indexFor(from: NodeId, to: NodeId, type: TEdgeType | NullEdgeType): number {
    let index = hashToIndex(this.hash(from, to, type));
    // we scan the `edges` array for the next empty slot after the `index`.
    // We do this instead of simply using the `index` because it is possible
    // for multiple edges to have the same hash.
    while (this.edges[index + TYPE]) {
      // If the edge at this index was deleted, we can reuse the slot.
      if (isDeleted(this.edges[index + TYPE])) break;
      if (
        this.edges[index + FROM] === from &&
        this.edges[index + TO] === to &&
        // if type === ALL_EDGE_TYPES, return all edges
        (type === ALL_EDGE_TYPES || this.edges[index + TYPE] === type)
      ) {
        // If this edge is already in the graph, bail out.
        return -1;
      } else {
        // There is already an edge at `hash`,
        // so scan forward for the next open slot to use as the the `hash`.
        // Note that each 'slot' is of size `EDGE_SIZE`.
        // Also note that we handle overflow of `edges` by wrapping
        // back to the beginning of the `edges` array.
        index = (index + EDGE_SIZE) % this.edges.length;
      }
    }

    return index;
  }

  // Probably not the best way to do this
  // Doesn't work if you add multiple edges between the same nodes
  // ex:
  // graph.addEdge(1, 2, 2)
  // graph.addEdge(1, 2, 3)
  // graph.getAllEdges() only returns [{from: 1, to: 2, type: 2}]
  getAllEdges(): Array<Edge<TEdgeType | NullEdgeType>> {
    let edgeObjs = [];
    for (let i = 0; i < this.nodes.length; i += NODE_SIZE) {
      let nextEdge = this.nodes[i + FIRST_OUT];
      while (nextEdge) {
        let edgeIndex = hashToIndex(nextEdge);
        edgeObjs.push({
          from: toNodeId(this.edges[edgeIndex + FROM]),
          to: toNodeId(this.edges[edgeIndex + TO]),
          type: deletedThrows(this.edges[edgeIndex + TYPE]),
        });
        nextEdge = this.edges[edgeIndex + NEXT_OUT];
      }
    }
    return edgeObjs;
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

    // Remove outgoing ref to this edge from incoming node.
    let nextOut = this.edges[index + NEXT_OUT];
    let outIndex = hashToIndex(this.nodes[indexOfNode(from) + FIRST_OUT]);
    if (outIndex === index) {
      this.nodes[indexOfNode(from) + FIRST_OUT] = nextOut;
    } else {
      let prevOut = outIndex;
      do {
        outIndex = hashToIndex(this.edges[outIndex + NEXT_OUT]);
        if (outIndex === index) {
          this.edges[prevOut + NEXT_OUT] = nextOut;
          break;
        }
        prevOut = outIndex;
      } while (outIndex);
    }

    // Remove incoming ref to this edge from to outgoing node.
    let nextIn = this.edges[index + NEXT_IN];
    let inIndex = hashToIndex(this.nodes[indexOfNode(to) + FIRST_IN]);
    if (inIndex === index) {
      this.nodes[indexOfNode(to) + FIRST_IN] = nextIn;
    } else {
      let prevIn = inIndex;
      do {
        inIndex = hashToIndex(this.edges[inIndex + NEXT_IN]);
        if (inIndex === index) {
          this.edges[prevIn + NEXT_IN] = nextIn;
          break;
        }
        prevIn = inIndex;
      } while (inIndex);
    }

    // Mark this slot as DELETED.
    // We do this so that clustered edges can still be found
    // by scanning forward in the array from the first index for
    // the cluster.
    this.edges[index + TYPE] = DELETED;
    this.edges[index + FROM] = 0;
    this.edges[index + TO] = 0;
    this.edges[index + NEXT_IN] = 0;
    this.edges[index + NEXT_OUT] = 0;

    this.numEdges--;
  }

  *getInboundEdgesByType(
    to: NodeId,
  ): Iterable<{|type: TEdgeType, from: NodeId|}> {
    for (
      let hash = this.nodes[indexOfNode(to) + FIRST_IN];
      hash;
      hash = this.edges[hashToIndex(hash) + NEXT_IN]
    ) {
      let i = hashToIndex(hash);
      yield {
        type: deletedThrows(this.edges[i + TYPE]),
        from: toNodeId(this.edges[i + FROM]),
      };
    }
  }

  *getOutboundEdgesByType(
    from: NodeId,
  ): Iterable<{|type: TEdgeType, to: NodeId|}> {
    for (
      let hash = this.nodes[indexOfNode(from) + FIRST_OUT];
      hash;
      hash = this.edges[hashToIndex(hash) + NEXT_OUT]
    ) {
      let i = hashToIndex(hash);
      yield {
        type: deletedThrows(this.edges[i + TYPE]),
        to: toNodeId(this.edges[i + TO]),
      };
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
    for (
      let hash = this.nodes[indexOfNode(from) + FIRST_OUT];
      hash;
      hash = this.edges[hashToIndex(hash) + NEXT_OUT]
    ) {
      let i = hashToIndex(hash);
      let edgeType = deletedThrows(this.edges[i + TYPE]);
      if (Array.isArray(type)) {
        for (let typeNum of type) {
          if (typeNum === ALL_EDGE_TYPES || edgeType === typeNum) {
            yield toNodeId(this.edges[i + TO]);
          }
        }
      } else {
        if (type === ALL_EDGE_TYPES || edgeType === type) {
          yield toNodeId(this.edges[i + TO]);
        }
      }
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
    for (
      let hash = this.nodes[indexOfNode(to) + FIRST_IN];
      hash;
      hash = this.edges[hashToIndex(hash) + NEXT_IN]
    ) {
      let i = hashToIndex(hash);
      let edgeType = deletedThrows(this.edges[i + TYPE]);
      if (Array.isArray(type)) {
        for (let typeNum of type) {
          if (typeNum === ALL_EDGE_TYPES || edgeType === typeNum) {
            yield toNodeId(this.edges[i + FROM]);
          }
        }
      } else {
        if (type === ALL_EDGE_TYPES || edgeType === type) {
          yield toNodeId(this.edges[i + FROM]);
        }
      }
    }
  }

  /**
   * Create a hash of the edge connecting the `from` and `to` nodes.
   *
   * This hash is used to index the edge in the `edges` array.
   *
   */
  hash(from: NodeId, to: NodeId, type: TEdgeType | NullEdgeType): number {
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

function toDot<TEdgeType: number>(data: EfficientGraph<TEdgeType>): string {
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
        label: `edge ${label} | { <TYPE> ${type} | <FROM> ${from} | <TO> ${to} | <NEXT_IN> ${nextIn} | <NEXT_OUT> ${nextOut} }`,
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

function nodesToDot<TEdgeType: number>(
  data: EfficientGraph<TEdgeType>,
): string {
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

function edgesToDot<TEdgeType: number>(
  data: EfficientGraph<TEdgeType>,
): string {
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
      let nextIn = data.edges[i + NEXT_IN];
      let nextOut = data.edges[i + NEXT_OUT];

      if (lastOut < i - EDGE_SIZE) {
        if (lastOut === 0) {
          edges.addNode(`edge${lastOut}`, {
            label: `${lastOut}…${i - EDGE_SIZE} | `,
            ...emptyColor,
          });
        } else {
          edges.addNode(`edge${lastOut + EDGE_SIZE}`, {
            label: `${lastOut + EDGE_SIZE}…${i - EDGE_SIZE} | `,
            ...emptyColor,
          });
          edges.addEdge(`edge${lastOut}`, `edge${lastOut + EDGE_SIZE}`);
          lastOut += EDGE_SIZE;
        }
      }

      edges.addNode(`edge${i}`, {
        label: `${indexToHash(
          i,
        )} | {${type} | ${from} | ${to} | ${nextIn} | ${nextOut}}`,
      });

      edges.addEdge(`edge${lastOut}`, `edge${i}`);
      lastOut = i;
    } else if (i === data.edges.length - EDGE_SIZE) {
      if (lastOut < i - EDGE_SIZE) {
        if (lastOut === 0) {
          edges.addNode(`edge${lastOut}`, {
            label: `${lastOut}…${i - EDGE_SIZE} | `,
            ...emptyColor,
          });
        } else {
          edges.addNode(`edge${lastOut + EDGE_SIZE}`, {
            label: `${lastOut + EDGE_SIZE}…${i - EDGE_SIZE} | `,
            ...emptyColor,
          });
          edges.addEdge(`edge${lastOut}`, `edge${lastOut + EDGE_SIZE}`);
        }
      }
    }
  }

  return g.to_dot();
}

export function openGraphViz<TEdgeType: number>(
  data: EfficientGraph<TEdgeType>,
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
