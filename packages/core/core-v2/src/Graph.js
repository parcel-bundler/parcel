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
    this.edges.add(edge);
  }

  removeNode(node /*: Node */) {
    this.nodes.delete(node.id);

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
    for (let edge2 of this.edges) {
      if (this.isSameEdge(edge, edge2)) {
        this.edges.remove(edge2);
      }
    }

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

  isSameEdge(edgeA, edgeB) {
    return edgeA.from === edgeB.from && edgeA.to === edgeB.to;
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

  async dumpGraphViz() {
    let graphviz = require('graphviz');
    let tempy = require('tempy');

    let g = graphviz.digraph('G');

    let colors = {
      'root': 'gray',
      'asset': 'green',
      'dep': 'orange',
      'file': 'cyan',
    };

    for (let [id, node] of this.nodes) {
      let n = g.addNode(id);
      // console.log(node);
      n.set('color', colors[node.type]);
      n.set('shape', 'box');
      n.set('style', 'filled');
      n.set('label', `${node.type}: ${node.id}`);
    }

    for (let edge of this.edges) {
      let e = g.addEdge(edge.from, edge.to);
    }

    let tmp = tempy.file({ name: 'graph.png' });

    await g.output('png', tmp);
    console.log(`open ${tmp}`);
  }
}

module.exports = Graph;
