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
    let path = require('path');

    let g = graphviz.digraph('G');

    let colors = {
      'root': 'gray',
      'asset': 'green',
      'dep': 'orange',
      'file': 'cyan',
    };

    let nodes = Array.from(this.nodes.values());
    let root = nodes.find(n => n.type === 'root');
    let rootPath = root ? root.value : '/';

    for (let node of nodes) {
      let n = g.addNode(node.id);

      n.set('color', colors[node.type]);
      n.set('shape', 'box');
      n.set('style', 'filled');

      let label = `${node.type}: `;

      if (node.type === 'dep') {
        label += node.value.moduleSpecifier;
        let parts = [];
        if (node.value.isEntry) parts.push('entry');
        if (node.value.isAsync) parts.push('async');
        if (node.value.isIncluded) parts.push('included');
        if (node.value.isOptional) parts.push('optional');
        if (parts.length) label += '(' + parts.join(', ') + ')';
      } else if (node.type === 'asset') {
        label += path.relative(rootPath, node.value.filePath) + '#' + node.value.hash.slice(0, 8);
      } else if (node.type === 'file') {
        label += path.relative(rootPath, node.value);
      } else {
        label += node.id;
      }

      n.set('label', label);
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
