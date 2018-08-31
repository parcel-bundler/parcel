
// @flow
'use strict';
import Graph, { Node, type NodeId } from './Graph';
import type { Dependency, Asset, File } from './types';
import type { Edge } from './Graph';

export interface RootNode extends Node {
  type: 'root';
  value: string;
}

export interface DependencyNode extends Node {
  type: 'dependency';
  value: Dependency;
}

export interface FileNode extends Node {
  type: 'file';
  value: File;
}

export interface AssetNode extends Node {
  type: 'asset';
  value: Asset;
}

export type AssetGraphNode = RootNode|DependencyNode|FileNode|AssetNode;

const rootNode = (rootDir: string) => ({
  id: rootDir,
  type: 'root',
  value: rootDir,
});

const depNode = (dep: Dependency) => ({
  id: `${dep.sourcePath}:${dep.moduleSpecifier}`,
  type: 'dependency',
  value: dep,
});

const fileNode = (file: File): FileNode => ({
  id: file.filePath,
  type: 'file',
  value: file,
});

const assetNode = (asset: Asset) => ({
  id: asset.hash,
  type: 'asset',
  value: asset,
});

type AssetGraphOpts = {
  entries: Array<string>,
  rootDir: string,
}

export default class AssetGraph extends Graph<AssetGraphNode> {
  incompleteNodes: Set<AssetGraphNode>;

  constructor({ entries, rootDir }: AssetGraphOpts) {
    super();
    this.incompleteNodes = new Set();
    this.initializeGraph({ entries, rootDir });
  }

  initializeGraph({ entries, rootDir }: AssetGraphOpts) {
    let node = rootNode(rootDir);
    this.addNode(node);

    for (let entry of entries) {
      let dependency = {
        sourcePath: rootDir,
        moduleSpecifier: entry,
      }
      this.addDependencyNode(node, dependency);
    }
  }

  addDependencyNode(from: AssetNode|RootNode, dep: Dependency) {
    if (this.hasDependencyNode(dep)) return this.getDependencyNode(dep);

    let node = depNode(dep);
    this.addNode(node);
    this.addEdge({ from: from.id, to: node.id });
    this.incompleteNodes.add(node);

    return node;
  }

  hasDependencyNode(dep: Dependency) {
    let node = depNode(dep);
    return this.nodes.has(node.id);
  }

  getDependencyNode(dep: Dependency) {
    let node = depNode(dep);
    node = this.nodes.get(node.id);
    if (!node || node.type !== 'dependency') throw new Error('Invalid Graph');
    return node;
  }

  addFileNode(from: DependencyNode, file: File): FileNode {
    if (this.hasFileNode(file)) return this.getFileNode(file);

    let node = fileNode(file);
    this.addNode(node);
    this.addEdge({ from: from.id, to: node.id });
    this.incompleteNodes.delete(from);
    this.incompleteNodes.add(node);

    return node;
  }

  hasFileNode(file: File) {
    let node = fileNode(file);
    return this.nodes.has(node.id);
  }

  getFileNode(file: File) {
    let node = fileNode(file);
    node = this.nodes.get(node.id);
    if (!node || node.type !== 'file') throw new Error('Invalid Graph');
    return node;
  }

  addAssetNode(from: FileNode, asset: Asset) {
    if (this.hasAssetNode(asset)) return this.getAssetNode(asset);

    let node = assetNode(asset);
    this.addNode(node);
    this.addEdge({ from: from.id, to: node.id });
    this.incompleteNodes.delete(from);

    return node;
  }

  hasAssetNode(asset: Asset) {
    let node = assetNode(asset);
    return this.nodes.has(node.id);
  }

  getAssetNode(asset: Asset) {
    let node = assetNode(asset);
    node = this.nodes.get(node.id);
    if (!node || node.type !== 'asset') throw new Error('Invalid Graph');
    return node;
  }

  removeNode(node: AssetGraphNode) {
    this.incompleteNodes.delete(node);
    return super.removeNode(node);
  }

  async dumpGraphViz() {
    let graphviz = require('graphviz');
    let tempy = require('tempy');
    let path = require('path');

    let g = graphviz.digraph('G');

    let colors = {
      'root': 'gray',
      'asset': 'green',
      'dependency': 'orange',
      'file': 'cyan',
    };

    let nodes = Array.from(this.nodes.values());
    let root
    for (let node of nodes) {
      if (node.type === 'root') {
        root = node;
        break;
      }
    }
    let rootPath = root ? root.value : '/';

    for (let node of nodes) {
      let n = g.addNode(node.id);

      n.set('color', colors[node.type]);
      n.set('shape', 'box');
      n.set('style', 'filled');

      let label = `${node.type}: `;

      if (node.type === 'dependency') {
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
        label += path.relative(rootPath, node.value.filePath);
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
