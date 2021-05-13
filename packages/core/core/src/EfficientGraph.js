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
const TYPE: 0 = 0;
/** The offset to `EDGE_SIZE` at which the 'from' node id is stored. */
const FROM: 1 = 1;
/** The offset to `EDGE_SIZE` at which the 'to' node id is stored. */
const TO: 2 = 2;
/** The offset to `EDGE_SIZE` at which the hash of the 'to' node's incoming edge is stored. */
const NEXT_IN: 3 = 3;
/** The offset to `EDGE_SIZE` at which the hash of the 'from' node's incoming edge is stored. */
const NEXT_OUT: 4 = 4;

/** The offset to `NODE_SIZE` at which the hash of the first incoming edge is stored. */
const FIRST_IN: 0 = 0;
/** The offset to `NODE_SIZE` at which the hash of the first outgoing edge is stored. */
const FIRST_OUT: 1 = 1;

export const ALL_EDGE_TYPES: AllEdgeTypes = '@@all_edge_types';

type EfficientGraphOpts = {|
  nodes: Uint32Array,
  edges: Uint32Array,
  numNodes: number,
  numEdges: number,
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
const edgeAt = (index: number): EdgeHash => index + 1;
/** Get the index in the edges array of the given edge. */
const indexOfEdge = (hash: EdgeHash) => Math.max(0, hash - 1);

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
  static deserialize(opts: EfficientGraphOpts): EfficientGraph<TEdgeType> {
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
      let lastIndex = null;
      for (
        /** The next edge to be copied. */
        let hash = this.nodes[from + FIRST_OUT];
        hash;
        hash = edges[indexOfEdge(hash) + NEXT_OUT]
      ) {
        /** The node that the next outgoing edge connects to. */
        let to = edges[indexOfEdge(hash) + TO];
        let type = edges[indexOfEdge(hash) + TYPE];
        /** The index at which to copy this edge. */
        let index = this.index(toNodeId(from), toNodeId(to), type);
        if (index === -1) {
          // Edge already copied?
          continue;
        }

        // Copy the details of the edge into the new edge list.
        this.edges[index + TYPE] = type;
        this.edges[index + FROM] = from;
        this.edges[index + TO] = to;
        if (lastIndex != null) {
          // If this edge is not the first outgoing edge from the current node,
          // link this edge to the last outgoing edge copied.
          this.edges[lastIndex + NEXT_OUT] = edgeAt(index);
        } else {
          // If this edge is the first outgoing edge from the current node,
          // link this edge to the current node.
          this.nodes[from + FIRST_OUT] = edgeAt(index);
        }
        // Keep track of the last outgoing edge copied.
        lastIndex = index;
      }

      // Reset lastHash for use while copying incoming edges.
      lastIndex = undefined;
      for (
        /** The next incoming edge to be copied. */
        let hash = this.nodes[from + FIRST_IN];
        hash;
        hash = edges[indexOfEdge(hash) + NEXT_IN]
      ) {
        /** The node that the next incoming edge connects from. */
        let from = edges[indexOfEdge(hash) + FROM];
        let type = edges[indexOfEdge(hash) + TYPE];
        /** The index at which to copy this edge. */
        let index = this.hash(toNodeId(from), toNodeId(from), type);
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
        this.edges[index + TYPE] = type;
        this.edges[index + FROM] = from;
        this.edges[index + TO] = from;
        if (lastIndex != null) {
          // If this edge is not the first incoming edge to the current node,
          // link this edge to the last incoming edge copied.
          this.edges[lastIndex + NEXT_IN] = edgeAt(index);
        } else {
          // If this edge is the first incoming edge from the current node,
          // link this edge to the current node.
          this.nodes[from + FIRST_IN] = edgeAt(index);
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
  addEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): boolean {
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
    let index = this.index(from, to, type);

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
    this.edges[index + NEXT_IN] = this.nodes[indexOfNode(to) + FIRST_IN];
    this.edges[index + NEXT_OUT] = this.nodes[indexOfNode(from) + FIRST_OUT];
    // We store the hash of this edge as the `to` node's incoming edge
    // and as the `from` node's outgoing edge.
    this.nodes[indexOfNode(to) + FIRST_IN] = edgeAt(index);
    this.nodes[indexOfNode(from) + FIRST_OUT] = edgeAt(index);

    return true;
  }

  /**
   * Get the index at which to add an edge connecting the `from` and `to` nodes.
   *
   * If an edge connecting `from` and `to` already exists, returns `-1`,
   * otherwise, returns the index at which the edge should be added.
   *
   */
  index(from: NodeId, to: NodeId, type: TEdgeType | NullEdgeType): number {
    let index = indexOfEdge(this.hash(from, to, type));
    // we scan the `edges` array for the next empty slot after the `index`.
    // We do this instead of simply using the `index` because it is possible
    // for multiple edges to have the same hash.
    while (this.edges[index + TYPE]) {
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
    let i = 0;
    while (i < this.edges.length) {
      if (this.edges[i + TYPE]) {
        edgeObjs.push({
          from: toNodeId(this.edges[i + FROM]),
          to: toNodeId(this.edges[i + TO]),
          type: (this.edges[i + TYPE]: any),
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
  hasEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): boolean {
    return this.index(from, to, type) === -1;
  }

  /**
   *
   */
  removeEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | NullEdgeType = 1,
  ): void {
    if (this.index(from, to, type) !== -1) {
      // The edge is not in the graph; do nothing.
      return;
    }

    let index = indexOfEdge(this.hash(from, to, type));

    // Remove outgoing ref to this edge from incoming node.
    let nextOut = this.edges[index + NEXT_OUT];
    let outIndex = indexOfEdge(this.nodes[indexOfNode(from) + FIRST_OUT]);
    if (outIndex === index) {
      this.nodes[indexOfNode(from) + FIRST_OUT] = nextOut;
    } else {
      let prevOut = outIndex;
      do {
        outIndex = indexOfEdge(this.edges[outIndex + NEXT_OUT]);
        if (outIndex === index) {
          this.edges[prevOut + NEXT_OUT] = nextOut;
          break;
        }
      } while (outIndex);
    }

    // Remove incoming ref to this edge from to outgoing node.
    let nextIn = this.edges[index + NEXT_IN];
    let inIndex = indexOfEdge(this.nodes[indexOfNode(to) + FIRST_IN]);
    if (inIndex === index) {
      this.nodes[indexOfNode(to) + FIRST_IN] = nextIn;
    } else {
      let prevIn = inIndex;
      do {
        inIndex = indexOfEdge(this.edges[inIndex + NEXT_IN]);
        if (inIndex === index) {
          this.edges[prevIn + NEXT_IN] = nextIn;
          break;
        }
      } while (inIndex);
    }

    // Free up this space in the edges list.
    this.edges[index + TYPE] = 0;
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
      let i = indexOfEdge(this.nodes[indexOfNode(to) + FIRST_IN]);
      i;
      i = indexOfEdge(this.edges[i + NEXT_IN])
    ) {
      yield {
        type: (this.edges[i + TYPE]: any),
        from: toNodeId(this.edges[i + FROM]),
      };
    }
  }

  *getOutboundEdgesByType(
    from: NodeId,
  ): Iterable<{|type: TEdgeType, to: NodeId|}> {
    for (
      let i = indexOfEdge(this.nodes[indexOfNode(from) + FIRST_OUT]);
      i;
      i = indexOfEdge(this.edges[i + NEXT_OUT])
    ) {
      yield {
        type: (this.edges[i + TYPE]: any),
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
   *
   */
  // getEdgesByType(from: NodeId): $ReadOnlyMap<number, $ReadOnlySet<NodeId>> {
  //   let typeMap = new Map();
  //   for (
  //     let i = this.nodes[indexOfNode(from) + FIRST_OUT];
  //     i;
  //     i = this.edges[indexOfEdge(i) + NEXT_OUT]
  //   ) {
  //     let type = this.edges[indexOfEdge(i) + TYPE];
  //     let nodeSet = typeMap.get(type) || new Set();
  //     nodeSet.add(toNodeId(i));
  //     typeMap.set(type, nodeSet);
  //   }
  //   return typeMap;
  // }
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
      let i = indexOfEdge(this.nodes[indexOfNode(from) + FIRST_OUT]);
      i;
      i = indexOfEdge(this.edges[i + NEXT_OUT])
    ) {
      if (Array.isArray(type)) {
        for (let typeNum of type) {
          if (typeNum === ALL_EDGE_TYPES || this.edges[i + TYPE] === typeNum) {
            yield toNodeId(this.edges[i + TO]);
          }
        }
      } else {
        if (type === ALL_EDGE_TYPES || this.edges[i + TYPE] === type) {
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
      let i = indexOfEdge(this.nodes[indexOfNode(to) + FIRST_IN]);
      i;
      i = indexOfEdge(this.edges[i + NEXT_IN])
    ) {
      if (Array.isArray(type)) {
        for (let typeNum of type) {
          if (typeNum === ALL_EDGE_TYPES || this.edges[i + TYPE] === typeNum) {
            yield toNodeId(this.edges[i + FROM]);
          }
        }
      } else {
        if (type === ALL_EDGE_TYPES || this.edges[i + TYPE] === type) {
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
    return (
      1 + // 1 is added to every hash to guarantee a truthy result.
      Math.abs(
        // TODO: Look more into how this hash function works
        ((type + 555555) *
          (fromNodeId(from) + 111111) *
          (fromNodeId(to) - 333333) *
          EDGE_SIZE) %
          this.edges.length,
      )
    );
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

  // Need to be updated to support `type`
  // TODO: hasEdge(from: NodeId, to: NodeId, type?: TEdgeType | NullEdgeType = 0): boolean {
  // TODO: getNodesConnectedFrom()
  // TODO: getNodesConnectedTo()

  // AdjacencyList
  // removeEdge(from: NodeId, to: NodeId, type: TEdgeType): void {
  // getEdges(from: NodeId, type: TEdgeType): $ReadOnlySet<NodeId> {
  // getEdgesByType(from: NodeId): $ReadOnlyMap<TEdgeType, $ReadOnlySet<NodeId>> {
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
      let index = indexOfEdge(nextEdge);
      let type = data.edges[index + TYPE];
      let from = data.edges[index + FROM];
      let to = data.edges[index + TO];
      let nextIn = data.edges[index + NEXT_IN];
      let nextOut = data.edges[index + NEXT_OUT];
      // TODO: add type to label?
      let label = String(nextEdge);

      graph.addEdge(
        String(nodeAt(i)),
        String(data.edges[indexOfEdge(nextEdge) + TO]),
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
    if (type) {
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
        label: `${edgeAt(
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
