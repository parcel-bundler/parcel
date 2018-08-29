
const Graph = require('./Graph');

const depNode = (dep) => ({
  id: dep.sourcePath + ':' + dep.moduleSpecifier,
  type: 'dependency',
  value: dep,
  fromEdges: [],
  toEdges: [],
});

const fileNode = (file) => ({
  id: file.filePath,
  type: 'file',
  value: file,
  fromEdges: [],
  toEdges: [],
});

const assetNode = (asset) => ({
  id: asset.hash,
  type: 'asset',
  value: asset,
  fromEdges: [],
  toEdges: [],
});

class AssetGraph extends Graph {
  constructor({ entries, rootDir }) {
    super();
    this.incompleteNodes = new Set();
    this.initializeGraph({ entries, rootDir });
  }

  initializeGraph({ entries, rootDir }) {
    let rootNode = {
      id: rootDir,
      type: 'root',
      fromEdges: [],
    };
    this.addNode(rootNode);

    for (let entry of entries) {
      let dependency = {
        sourcePath: rootDir,
        moduleSpecifier: entry,
      }
      this.addDependencyNode(rootNode, dependency);
    }
  }

  invalidateNode(nodeId) {
    let node = this.nodes.get(nodeId);
    this.incompleteNodes.add(node);
  }

  addDependencyNode(from, dep) {
    if (this.hasDependencyNode(dep)) return this.getDependencyNode(dep);

    let node = depNode(dep);
    this.addNode(node);
    this.addEdge({ from: from.id, to: node.id });
    this.incompleteNodes.add(node);

    return node;
  }

  hasDependencyNode(dep) {
    let node = depNode(dep);
    return this.nodes.has(node.id);
  }

  getDependencyNode(dep) {
    let node = depNode(dep);
    return this.nodes.get(node.id);
  }

  addFileNode(from, file) {
    if (this.hasFileNode(file)) return this.getFileNode(file);

    let node = fileNode(file);
    this.addNode(node);
    this.addEdge({ from: from.id, to: node.id });
    this.incompleteNodes.delete(from);
    this.incompleteNodes.add(node);

    return node;
  }

  hasFileNode(file) {
    let node = fileNode(file);
    return this.nodes.has(node.id);
  }

  getFileNode(file) {
    let node = fileNode(file);
    return this.nodes.get(node.id);
  }

  addAssetNode(from, asset) {
    if (this.hasAssetNode(asset)) return this.getAssetNode(asset);

    let node = assetNode(asset);
    this.addNode(node);
    this.addEdge({ from: from.id, to: node.id });
    this.incompleteNodes.delete(from);

    return node;
  }

  hasAssetNode(asset) {
    let node = assetNode(asset);
    return this.nodes.has(node.id);
  }

  getAssetNode(asset) {
    let node = assetNode(asset);
    return this.nodes.get(node.id);
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

module.exports = AssetGraph;
