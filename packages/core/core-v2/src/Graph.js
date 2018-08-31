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

    let invalidated = [];

    for (let edge of this.edges) {
      if (edge.to === node.id) {
        invalidated.push(edge);
      }

      if (edge.from === node.id) {
        invalidated = invalidated.concat(this.removeEdge(edge));
      }
    }

    return invalidated;
  }

  removeEdge(edge: Edge): Array<Node|Edge> {
    this.edges.delete(edge);

    let invalidated = [];

    for (let [id, node] of this.nodes) {
      if (edge.from === id) {
        invalidated.push(node);
      }

      if (edge.to === id) {
        if (this.isOrphanedNode(node)) {
          invalidated = invalidated.concat(this.removeNode(node));
        }
      }
    }

    return invalidated;
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
