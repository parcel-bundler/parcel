// @flow
'use strict';

export type NodeId = string;

export type Edge = {
  from: NodeId,
  to: NodeId,
};

export interface Node {
  id: string;
  value: any;
}

export default class Graph<Node: Node> {
  nodes: Map<NodeId, Node>;
  edges: Set<Edge>;

  constructor() {
    this.nodes = new Map();
    this.edges = new Set();
  }

  addNode(node: Node) {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: Edge) {
    this.edges.add(edge);
  }

  merge(graph: Graph<Node>) {
    for (let [id, node] of graph.nodes) {
      this.addNode(node);
    }

    for (let edge of graph.edges) {
      this.addEdge(edge);
    }
  }

  removeNode(node: Node): Graph<Node> {
    let removed = new Graph();

    this.nodes.delete(node.id);
    removed.addNode(node);

    for (let edge of this.edges) {
      if (edge.from === node.id) {
        removed.merge(this.removeEdge(edge));
      }
    }

    return removed;
  }

  removeEdge(edge: Edge): Graph<Node> {
    let removed = new Graph();

    this.edges.delete(edge);
    removed.addEdge(edge);

    for (let [id, node] of this.nodes) {
      if (edge.to === id) {
        if (this.isOrphanedNode(node)) {
          removed.merge(this.removeNode(node));
        }
      }
    }

    return removed;
  }

  isOrphanedNode(node /*: Node */) {
    for (let edge of this.edges) {
      if (edge.to === node.id) {
        return true;
      }
    }
    return true;
  }
}
