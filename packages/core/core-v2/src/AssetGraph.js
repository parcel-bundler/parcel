
// @flow
'use strict';
import Graph, { Node, type NodeId } from './Graph';
import type { Dependency, Asset, File } from './types';

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

export const nodeFromRootDir = (rootDir: string) => ({
  id: rootDir,
  type: 'root',
  value: rootDir,
});

export const nodeFromDep = (dep: Dependency) => ({
  id: `${dep.sourcePath}:${dep.moduleSpecifier}`,
  type: 'dependency',
  value: dep,
});

export const nodeFromFile = (file: File) => ({
  id: file.filePath,
  type: 'file',
  value: file,
});

export const nodeFromAsset = (asset: Asset) => ({
  id: asset.hash,
  type: 'asset',
  value: asset,
});

const getFileNodesFromGraph = (graph: Graph<Node>): Array<File> => {
  return Array.from(graph.nodes.values())
    .filter((node: any) => node.type === 'file')
    .map(node => node.value);
}

const getDepNodesFromGraph = (graph: Graph<Node>): Array<Dependency> => {
  return Array.from(graph.nodes.values())
    .filter((node: any) => node.type === 'dependency')
    .map(node => node.value);
}

type DepUpdates = {
  newFile?: File,
  prunedFiles: Array<File>,
}

type FileUpdates = {
  newDeps: Array<Dependency>,
  prunedFiles: Array<File>
}

type AssetGraphOpts = {
  entries: Array<string>,
  rootDir: string,
}

export default class AssetGraph extends Graph<AssetGraphNode> {
  incompleteNodes: Map<NodeId, AssetGraphNode>;

  constructor({ entries, rootDir }: AssetGraphOpts) {
    super();
    this.incompleteNodes = new Map();
    this.initializeGraph({ entries, rootDir });
  }

  initializeGraph({ entries, rootDir }: AssetGraphOpts) {
    let rootNode = nodeFromRootDir(rootDir);
    this.addNode(rootNode);

    let depNodes = entries.map(entry => nodeFromDep({
      sourcePath: rootDir,
      moduleSpecifier: entry,
    }));

    this.updateDownStreamNodes(rootNode, depNodes);
    for (let depNode of depNodes) {
      this.incompleteNodes.set(depNode.id, depNode);
    }
  }

  removeNode(node: AssetGraphNode) {
    this.incompleteNodes.delete(node.id);
    return super.removeNode(node);
  }

  updateDependency(dep: Dependency, file: File): DepUpdates {
    let newFile;
    let prunedFiles = [];

    let depNode = nodeFromDep(dep);
    this.incompleteNodes.delete(depNode.id);

    let fileNode = nodeFromFile(file);
    let { added, removed } = this.updateDownStreamNodes(depNode, [fileNode]);

    if (added.nodes.size) {
      newFile = file;
      this.incompleteNodes.set(fileNode.id, fileNode);
    }

    prunedFiles = prunedFiles.concat(getFileNodesFromGraph(removed));
    return { newFile, prunedFiles };
  }

  updateFile(file: File, assets: Array<Asset>): FileUpdates {
    let newDeps: Array<Dependency> = [];
    let prunedFiles = [];

    let fileNode = nodeFromFile(file);
    this.incompleteNodes.delete(fileNode.id);

    let assetNodes = assets.map(asset => nodeFromAsset(asset));
    let fileNodeUpdates = this.updateDownStreamNodes(fileNode, assetNodes);

    prunedFiles = prunedFiles.concat(getFileNodesFromGraph(fileNodeUpdates.removed));

    for (let asset of assets) {
      let assetNode = nodeFromAsset(asset);
      let depNodes = asset.dependencies.map(dep => nodeFromDep({...dep, sourcePath: file.filePath}));
      let assetNodeUpdates = this.updateDownStreamNodes(assetNode, depNodes);
      prunedFiles = prunedFiles.concat(getFileNodesFromGraph(assetNodeUpdates.removed));
      newDeps = newDeps.concat(getDepNodesFromGraph(assetNodeUpdates.added));
    }

    for (let dep of newDeps) {
      let depNode = nodeFromDep(dep);
      this.incompleteNodes.set(depNode.id, depNode);
    }

    return { newDeps, prunedFiles };
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
