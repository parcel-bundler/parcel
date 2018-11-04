// @flow
'use strict';
import Graph, {Node, type NodeId} from './Graph';
import type {CacheEntry, Dependency, Asset, File} from '@parcel/types';
import path from 'path';

export const nodeFromRootDir = (rootDir: string) => ({
  id: rootDir,
  type: 'root',
  value: rootDir
});

export const nodeFromDep = (dep: Dependency) => ({
  id: `${dep.sourcePath}:${dep.moduleSpecifier}`,
  type: 'dependency',
  value: dep
});

export const nodeFromFile = (file: File) => ({
  id: file.filePath,
  type: 'file',
  value: file
});

export const nodeFromConnectedFile = (file: File) => ({
  id: file.filePath,
  type: 'connected_file',
  value: file
});

export const nodeFromAsset = (asset: Asset) => ({
  id: asset.hash,
  type: 'asset',
  value: asset
});

const getFileNodesFromGraph = (graph: Graph): Array<Node> => {
  return Array.from(graph.nodes.values()).filter(
    (node: any) => node.type === 'file' || node.type === 'connected_file'
  );
};

const getFilesFromGraph = (graph: Graph): Array<File> => {
  return getFileNodesFromGraph(graph).map(node => node.value);
};

const getDepNodesFromGraph = (graph: Graph): Array<Node> => {
  return Array.from(graph.nodes.values()).filter(
    (node: any) => node.type === 'dependency'
  );
};

type DepUpdates = {
  newFile?: File,
  prunedFiles: Array<File>
};

type FileUpdates = {
  newDeps: Array<Dependency>,
  addedFiles: Array<File>,
  removedFiles: Array<File>
};

type AssetGraphOpts = {
  entries: Array<string>,
  rootDir: string
};

/**
 * AssetGraph is a Graph with some extra rules.
 *  * Nodes can only have one of the following types "root", "dependency", "file", "asset"
 *  * There is one root node that represents the root directory
 *  * The root note has edges to dependency nodes for each entry file
 *  * A dependency node should have an edge to exactly one file node
 *  * A file node can have one to many edges to asset nodes which can have zero to many edges dependency nodes
 */
export default class AssetGraph extends Graph {
  incompleteNodes: Map<NodeId, Node>;
  invalidNodes: Map<NodeId, Node>;

  constructor({entries, rootDir}: AssetGraphOpts) {
    super();
    this.incompleteNodes = new Map();
    this.invalidNodes = new Map();
    this.initializeGraph({entries, rootDir});
  }

  initializeGraph({entries, rootDir}: AssetGraphOpts) {
    let rootNode = nodeFromRootDir(rootDir);
    this.addNode(rootNode);

    let depNodes = entries.map(entry =>
      nodeFromDep({
        sourcePath: path.resolve(rootDir, 'index'),
        moduleSpecifier: entry
      })
    );

    this.updateDownStreamNodes(rootNode, depNodes);
    for (let depNode of depNodes) {
      this.incompleteNodes.set(depNode.id, depNode);
    }
  }

  removeNode(node: Node) {
    this.incompleteNodes.delete(node.id);
    return super.removeNode(node);
  }

  // Once a dependency is resolved, connect it to a node representing the file it was resolved to
  updateDependency(dep: Dependency, file: File): DepUpdates {
    let newFile;

    let depNode = nodeFromDep(dep);
    this.incompleteNodes.delete(depNode.id);
    this.invalidNodes.delete(depNode.id);

    let fileNode = nodeFromFile(file);
    let {added, removed} = this.updateDownStreamNodes(depNode, [fileNode]);

    if (added.nodes.size) {
      newFile = file;
      this.incompleteNodes.set(fileNode.id, fileNode);
    }

    let prunedFiles = getFilesFromGraph(removed);
    return {newFile, prunedFiles};
  }

  // Once a file has been transformed, connect it to asset nodes representing the generated assets
  updateFile(file: File, cacheEntry: CacheEntry): FileUpdates {
    let newDepNodes: Array<Node> = [];

    let fileNode = nodeFromFile(file);
    this.incompleteNodes.delete(fileNode.id);
    this.invalidNodes.delete(fileNode.id);

    // Get connected files at the file level and asset level and connect them to the file node
    let fileNodes = cacheEntry.connectedFiles.map(file =>
      nodeFromConnectedFile(file)
    );
    for (let asset of cacheEntry.assets) {
      let files = asset.connectedFiles.map(file => nodeFromConnectedFile(file));
      fileNodes = fileNodes.concat(files);
    }

    let assetNodes = cacheEntry.assets.map(asset => nodeFromAsset(asset));
    let {added, removed} = this.updateDownStreamNodes(fileNode, [
      ...assetNodes,
      ...fileNodes
    ]);

    let addedFiles = getFilesFromGraph(added);
    let removedFiles = getFilesFromGraph(removed);

    for (let assetNode of assetNodes) {
      // TODO: dep should already have sourcePath
      let depNodes = assetNode.value.dependencies.map(dep => {
        dep.sourcePath = file.filePath;
        return nodeFromDep(dep);
      });
      let {removed, added} = this.updateDownStreamNodes(assetNode, depNodes);
      removedFiles = removedFiles.concat(getFilesFromGraph(removed));
      newDepNodes = newDepNodes.concat(getDepNodesFromGraph(added));
    }

    for (let depNode of newDepNodes) {
      this.incompleteNodes.set(depNode.id, depNode);
    }

    let newDeps = newDepNodes.map(node => node.value);

    return {newDeps, addedFiles, removedFiles};
  }

  invalidateNode(node: Node) {
    this.invalidNodes.set(node.id, node);
  }

  async dumpGraphViz() {
    let graphviz = require('graphviz');
    let tempy = require('tempy');
    let path = require('path');

    let g = graphviz.digraph('G');

    let colors = {
      root: 'gray',
      asset: 'green',
      dependency: 'orange',
      file: 'cyan',
      connected_file: 'gray',
      default: 'white'
    };

    let nodes = Array.from(this.nodes.values());
    let root;
    for (let node of nodes) {
      if (node.type === 'root') {
        root = node;
        break;
      }
    }
    let rootPath = root ? root.value : '/';

    for (let node of nodes) {
      let n = g.addNode(node.id);

      n.set('color', colors[node.type || 'default']);
      n.set('shape', 'box');
      n.set('style', 'filled');

      let label = `${node.type || 'No Type'}: `;

      if (node.type === 'dependency') {
        label += node.value.moduleSpecifier;
        let parts = [];
        if (node.value.isEntry) parts.push('entry');
        if (node.value.isAsync) parts.push('async');
        if (node.value.isIncluded) parts.push('included');
        if (node.value.isOptional) parts.push('optional');
        if (parts.length) label += '(' + parts.join(', ') + ')';
      } else if (node.type === 'asset') {
        label +=
          path.relative(rootPath, node.value.filePath) +
          '#' +
          node.value.hash.slice(0, 8);
      } else if (node.type === 'file' || node.type === 'connected_file') {
        label += path.relative(rootPath, node.value.filePath);
      } else {
        label += node.id;
      }

      n.set('label', label);
    }

    for (let edge of this.edges) {
      g.addEdge(edge.from, edge.to);
    }

    let tmp = tempy.file({name: 'graph.png'});

    await g.output('png', tmp);
    console.log(`open ${tmp}`); // eslint-disable-line no-console
  }
}
