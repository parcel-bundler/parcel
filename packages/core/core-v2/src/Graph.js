// @flow
'use strict';

/*::
export type NodeId = string;

export type Node = {
  id: NodeId,
  value: any,
};

export type Edge = {
  from: NodeId,
  to: NodeId,
};
*/

class Graph {

  /*::
  nodes: Map<NodeId, Node>;
  edges: Set<Edge>;
  */

  constructor() {
    this.nodes = new Map();
    this.edges = new Set();
  }

  addNode(node /*: Node */) {
    this.nodes.set(node.id, node);
  }

  addEdge(edge /*: Edge */) {
    let fromNode = this.nodes.get(edge.from);
    fromNode.fromEdges.push(edge);
    let toNode = this.nodes.get(edge.to);
    toNode.toEdges.push(edge);
    this.edges.add(edge);
  }

  removeNode(node /*: Node */) {
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

  removeEdge(edge /*: Edge */) {
    this.edges.remove(edge);

    let invalidated = [];

    for (let node of this.nodes) {
      if (edge.from === node.id) {
        invalidated.push(node);
      }

      if (edge.to === node.id) {
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

module.exports = Graph;
