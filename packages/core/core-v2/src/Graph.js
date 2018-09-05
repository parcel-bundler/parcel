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

  removeNode(node: Node): Array<Node|Edge> {
    this.nodes.delete(node.id);

    let removed = [];

    for (let edge of this.edges) {
      if (edge.from === node.id) {
        removed = removed.concat(this.removeEdge(edge));
      }
    }

    return removed;
  }

  removeEdge(edge: Edge): Array<Node|Edge> {
    this.edges.delete(edge);

    let removed = [];

    for (let [id, node] of this.nodes) {
      if (edge.to === id) {
        if (this.isOrphanedNode(node)) {
          removed = removed.concat(this.removeNode(node));
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
