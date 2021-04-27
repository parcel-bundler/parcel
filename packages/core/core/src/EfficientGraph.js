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

export const ALL_EDGE_TYPES = '@@all_edge_types';

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
    /** The edge list to be copied to the resized list. */
    let edges = this.edges;
    // Allocate the required space for an `edges` array of the given `size`.
    this.edges = new Uint32Array(size * EDGE_SIZE);

    // For each node in the graph, copy the existing edges into the new array.
    for (
      /** The next node with edges to copy. */
      let from = 0;
      from < this.nodes.length;
      from += NODE_SIZE
    ) {
      /** The last edge copied. */
      let lastHash;
      for (
        /** The next edge to be copied. */
        let hash = this.nodes[from + FIRST_OUT];
        hash;
        hash = edges[hash - 1 + NEXT_OUT]
      ) {
        /** The node that the next outgoing edge connects to. */
        let to = edges[hash - 1 + TO];
        /** The index at which to copy this edge. */
        let index = this.index(toNodeId(from), toNodeId(to));
        if (index === -1) {
          // Edge already copied?
          continue;
        }

        // Copy the details of the edge into the new edge list.
        this.edges[index + TYPE] = edges[hash - 1 + TYPE];
        this.edges[index + FROM] = from;
        this.edges[index + TO] = to;
        if (lastHash != null) {
          // If this edge is not the first outgoing edge from the current node,
          // link this edge to the last outgoing edge copied.
          this.edges[lastHash + NEXT_OUT] = 1 + index;
        } else {
          // If this edge is the first outgoing edge from the current node,
          // link this edge to the current node.
          this.nodes[from + FIRST_OUT] = 1 + index;
        }
        // Keep track of the last outgoing edge copied.
        lastHash = index;
      }

      // Reset lastHash for use while copying incoming edges.
      lastHash = undefined;
      for (
        /** The next incoming edge to be copied. */
        let hash = this.nodes[from + FIRST_IN];
        hash;
        hash = edges[hash - 1 + NEXT_IN]
      ) {
        /** The node that the next incoming edge connects from. */
        let from = edges[hash - 1 + FROM];
        /** The index at which to copy this edge. */
        let index = this.hash(toNodeId(from), toNodeId(from));
        // If there is a hash collision,
        // scan the edges array for a space to copy the edge.
        while (this.edges[index + TYPE]) {
          if (
            this.edges[index + FROM] === from &&
            this.edges[index + TO] === from
          ) {
            break;
          } else {
            index = (index + EDGE_SIZE) % this.edges.length;
          }
        }

        // Copy the details of the edge into the new edge list.
        this.edges[index + TYPE] = edges[hash - 1 + TYPE];
        this.edges[index + FROM] = from;
        this.edges[index + TO] = from;
        if (lastHash != null) {
          // If this edge is not the first incoming edge to the current node,
          // link this edge to the last incoming edge copied.
          this.edges[lastHash + NEXT_IN] = 1 + index;
        } else {
          // If this edge is the first incoming edge from the current node,
          // link this edge to the current node.
          this.nodes[from + FIRST_IN] = 1 + index;
        }

        // Keep track of the last edge copied.
        lastHash = index;
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
    return toNodeId(id);
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
  index(from: NodeId, to: NodeId, type: number = 1): number {
    // The index is most often simply the hash of edge.
    let hash = this.hash(from, to);

    // we scan the `edges` array for the next empty slot after the `hash` offset.
    // We do this instead of simply using the `hash` as the index because
    // it is possible for multiple edges to have the same hash.
    while (this.edges[hash + TYPE]) {
      if (
        this.edges[hash + FROM] === from &&
        this.edges[hash + TO] === to &&
        // if type === 1, the edge type isn't specified, so return
        (type === 1 || this.edges[hash + TYPE] === type)
      ) {
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

  // Probably not the best way to do this
  // Doesn't work if you add multiple edges between the same nodes
  // ex:
  // graph.addEdge(1, 2, 2)
  // graph.addEdge(1, 2, 3)
  // graph.getAllEdges() only returns [{from: 1, to: 2, type: 2}]
  getAllEdges(): Array<{|
    from: number,
    to: number,
    type: number,
    // nextIn: number,
    // nextOut: number,
  |}> {
    let edgeObjs = [];
    let i = 0;
    while (i < this.edges.length) {
      if (this.edges[i + TYPE]) {
        edgeObjs.push({
          from: this.edges[i + FROM],
          to: this.edges[i + TO],
          type: this.edges[i + TYPE],
          // nextIn: this.edges[i + NEXT_IN],
          // nextOut: this.edges[i + NEXT_OUT],
        });
        i += EDGE_SIZE;
      }
      i++;
    }
    return edgeObjs;
  }

  /**
   * Check if the graph has an edge connecting the `from` and `to` nodes.
   */
  hasEdge(from: NodeId, to: NodeId, type: number = 1): boolean {
    return this.index(from, to, type) === -1;
  }

  /**
   * Get the list of nodes connected from
   */
  *getNodesConnectedFrom(
    from: NodeId,
    type: number | Array<number> = 1,
  ): Iterable<NodeId> {
    for (
      let i = this.nodes[fromNodeId(from) + FIRST_OUT];
      i;
      i = this.edges[i - 1 + NEXT_OUT]
    ) {
      if (Array.isArray(type)) {
        for (let typeNum of type) {
          if (typeNum === 1 || this.edges[i - 1] === typeNum) {
            yield toNodeId(this.edges[i - 1 + TO]);
          }
        }
      } else {
        if (type === ALL_EDGE_TYPES || this.edges[i - 1] === type) {
          yield toNodeId(this.edges[i - 1 + TO]);
        }
      }
    }
  }

  /**
   * Get the list of nodes whose edges from to
   */
  *getNodesConnectedTo(
    to: NodeId,
    type: number | Array<number> = 1,
  ): Iterable<NodeId> {
    for (
      let i = this.nodes[fromNodeId(to) + FIRST_IN];
      i;
      i = this.edges[i - 1 + NEXT_IN]
    ) {
      if (Array.isArray(type)) {
        for (let typeNum of type) {
          if (typeNum === 1 || this.edges[i - 1] === typeNum) {
            yield toNodeId(this.edges[i - 1 + FROM]);
          }
        }
      } else {
        if (type === ALL_EDGE_TYPES || this.edges[i - 1] === type) {
          yield toNodeId(this.edges[i - 1 + FROM]);
        }
      }
    }
  }

  /**
   * Create a hash of the edge connecting the `from` and `to` nodes.
   *
   * This hash is used to index the edge in the `edges` array.
   *
   * This might need to include the type as well if we assume that
   * multiple edges can exist between two of the same nodes
   */
  hash(from: NodeId, to: NodeId): number {
    // TODO: understand this hash function
    return Math.abs(
      ((fromNodeId(from) + 111111) * (fromNodeId(to) - 333333) * EDGE_SIZE) %
        this.edges.length,
    );
  }

  // Need to be updated to support `type`
  // TODO: hasEdge(from: NodeId, to: NodeId, type?: TEdgeType | NullEdgeType = 0): boolean {
  // TODO: getNodesConnectedFrom()
  // TODO: getNodesConnectedTo()

  // AdjacencyList
  // removeEdge(from: NodeId, to: NodeId, type: TEdgeType): void {
  // getEdges(from: NodeId, type: TEdgeType): $ReadOnlySet<NodeId> {
  // getEdgesByType(from: NodeId): $ReadOnlyMap<TEdgeType, $ReadOnlySet<NodeId>> {
}
