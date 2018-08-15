// @flow
'use strict';

/*::
export type NodeId = string;
export type EdgeId = string;

export type Node = {
  type: 'node',
  id: NodeId,
  value: any,
};

export type Edge = {
  type: 'edge',
  id: EdgeId,
  from: NodeId,
  to: NodeId,
  value: any,
};
*/

class Graph {

  /*::
  nodes: Map<NodeId, Node>;
  edges: Map<EdgeId, Edge>;
  */

  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  addNode(node /*: Node */) {
    this.nodes.set(node.id, node);
  }

  addEdge(edge /*: Edge */) {
    this.edges.set(edge.id, edge);
  }

  removeNode(node /*: Node */) {
    this.nodes.delete(edge.id);

    let invalidated = [];

    for (let edge of this.edges) {
      if (edge.to === node.id) {
        invalidated.add(edge);
      }

      if (edge.from === node.id) {
        invalidated = invalidated.concat(this.removeEdge(edge));
      }
    }

    return invalidated;
  }

  removeEdge(edge /*: Edge */) {
    this.edges.delete(edge.id);

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

  findNodeByX() {
    // ...
  }
}

module.exports = Graph;
