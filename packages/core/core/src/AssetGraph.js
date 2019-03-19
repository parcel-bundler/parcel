// @flow
'use strict';
import Graph, {type NodeId} from './Graph';
import type {
  CacheEntry,
  Dependency as IDependency,
  Asset,
  File,
  FilePath,
  TransformerRequest,
  Target,
  Environment,
  AssetGraphNode,
  DependencyNode
} from '@parcel/types';
import md5 from '@parcel/utils/lib/md5';
import Dependency from './Dependency';

export const nodeFromRootDir = (rootDir: string) => ({
  id: rootDir,
  type: 'root',
  value: rootDir
});

export const nodeFromDep = (dep: IDependency) => ({
  id: dep.id,
  type: 'dependency',
  value: dep
});

export const nodeFromFile = (file: File) => ({
  id: file.filePath,
  type: 'file',
  value: file
});

export const nodeFromTransformerRequest = (req: TransformerRequest) => ({
  id: md5(`${req.filePath}:${JSON.stringify(req.env)}`),
  type: 'transformer_request',
  value: req
});

export const nodeFromAsset = (asset: Asset) => ({
  id: asset.id,
  type: 'asset',
  value: asset
});

const getFileNodesFromGraph = (graph: Graph<Node>): Array<Node> => {
  return graph.findNodes(node => node.type === 'file');
};

const getFilesFromGraph = (graph: Graph<Node>): Array<File> => {
  return getFileNodesFromGraph(graph).map(node => (node.value: any));
};

const getDepNodesFromGraph = (graph: Graph<Node>): Array<DependencyNode> => {
  return (graph.findNodes(node => node.type === 'dependency'): any);
};

type DepUpdates = {
  newRequest?: TransformerRequest,
  prunedFiles: Array<File>
};

type FileUpdates = {
  newDeps: Array<IDependency>,
  addedFiles: Array<File>,
  removedFiles: Array<File>
};

type AssetGraphOpts = {
  entries?: Array<string>,
  targets?: Array<Target>,
  transformerRequest?: TransformerRequest,
  rootDir: string
};

type RootNode = {
  id: string,
  type: 'root',
  value: string
};

type FileNode = {
  id: string,
  type: 'file',
  value: File
};

type TransformerRequestNode = {
  id: string,
  type: 'transformer_request',
  value: TransformerRequest
};

export type Node =
  | AssetGraphNode
  | RootNode
  | FileNode
  | TransformerRequestNode;

/**
 * AssetGraph is a Graph with some extra rules.
 *  * Nodes can only have one of the following types "root", "dependency", "file", "asset"
 *  * There is one root node that represents the root directory
 *  * The root note has edges to dependency nodes for each entry file
 *  * A dependency node should have an edge to exactly one file node
 *  * A file node can have one to many edges to asset nodes which can have zero to many edges dependency nodes
 */
export default class AssetGraph extends Graph<Node> {
  incompleteNodes: Map<NodeId, Node>;
  invalidNodes: Map<NodeId, Node>;

  constructor(opts: any) {
    super(opts);
    this.incompleteNodes = new Map();
    this.invalidNodes = new Map();
  }

  initializeGraph({
    entries,
    targets,
    transformerRequest,
    rootDir
  }: AssetGraphOpts) {
    let rootNode = nodeFromRootDir(rootDir);
    this.setRootNode(rootNode);

    let nodes = [];
    if (entries) {
      if (!targets) {
        throw new Error('Targets are required when entries are specified');
      }

      for (let entry of entries) {
        for (let target of targets) {
          let node = nodeFromDep(
            new Dependency({
              moduleSpecifier: entry,
              target: target,
              env: target.env,
              isEntry: true
            })
          );

          nodes.push(node);
        }
      }
    } else if (transformerRequest) {
      let node = nodeFromTransformerRequest(transformerRequest);
      nodes.push(node);
    }

    this.replaceNodesConnectedTo(rootNode, nodes);
    for (let depNode of nodes) {
      this.incompleteNodes.set(depNode.id, depNode);
    }
  }

  removeNode(node: Node): this {
    this.incompleteNodes.delete(node.id);
    return super.removeNode(node);
  }

  /**
   * Marks a dependency as resolved, and connects it to a transformer
   * request node for the file it was resolved to.
   */
  resolveDependency(dep: IDependency, req: TransformerRequest): DepUpdates {
    let newRequest;

    let depNode = nodeFromDep(dep);
    this.incompleteNodes.delete(depNode.id);
    this.invalidNodes.delete(depNode.id);

    let requestNode = nodeFromTransformerRequest(req);
    let {added, removed} = this.replaceNodesConnectedTo(depNode, [requestNode]);

    if (added.nodes.size) {
      newRequest = req;
      this.incompleteNodes.set(requestNode.id, requestNode);
    }

    let prunedFiles = getFilesFromGraph(removed);
    return {newRequest, prunedFiles};
  }

  /**
   * Marks a transformer request as resolved, and connects it to asset and file
   * nodes for the generated assets and connected files.
   */
  resolveTransformerRequest(
    req: TransformerRequest,
    cacheEntry: CacheEntry
  ): FileUpdates {
    let newDepNodes: Array<DependencyNode> = [];

    let requestNode = nodeFromTransformerRequest(req);
    this.incompleteNodes.delete(requestNode.id);
    this.invalidNodes.delete(requestNode.id);

    // Get connected files from each asset and connect them to the file node
    let fileNodes = [];
    for (let asset of cacheEntry.assets) {
      let files = asset.connectedFiles.map(file => nodeFromFile(file));
      fileNodes = fileNodes.concat(files);
    }

    // Add a file node for the file that the transformer request resolved to
    fileNodes.push(nodeFromFile({filePath: req.filePath}));

    let assetNodes = cacheEntry.assets.map(asset => nodeFromAsset(asset));
    let {added, removed} = this.replaceNodesConnectedTo(requestNode, [
      ...assetNodes,
      ...fileNodes
    ]);

    let addedFiles = getFilesFromGraph(added);
    let removedFiles = getFilesFromGraph(removed);

    for (let assetNode of assetNodes) {
      let depNodes = assetNode.value.dependencies.map(dep => {
        return nodeFromDep(dep);
      });
      let {removed, added} = this.replaceNodesConnectedTo(assetNode, depNodes);
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

  invalidateFile(filePath: FilePath) {
    let node = this.getNode(filePath);
    if (!node || node.type !== 'file') {
      return;
    }

    // Invalidate all file nodes connected to this node.
    for (let connectedNode of this.getNodesConnectedTo(node)) {
      if (connectedNode.type === 'transformer_request') {
        this.invalidateNode(connectedNode);
      }
    }
  }

  async dumpGraphViz() {
    let graphviz = require('graphviz');
    let tempy = require('tempy');
    let path = require('path');

    let g = graphviz.digraph('G');

    let colors = {
      root: 'gray',
      asset: 'green',
      asset_reference: 'green',
      dependency: 'orange',
      transformer_request: 'cyan',
      file: 'gray',
      default: 'white',
      bundle: 'gray',
      bundle_group: 'gray'
    };

    let nodes = Array.from(this.nodes.values());

    for (let node of nodes) {
      let n = g.addNode(node.id);

      n.set('color', colors[node.type]);
      n.set('shape', 'box');
      n.set('style', 'filled');

      let label = `${node.type || 'No Type'}: `;

      if (node.type === 'dependency') {
        label += node.value.moduleSpecifier;
        let parts = [];
        if (node.value.isEntry) parts.push('entry');
        if (node.value.isAsync) parts.push('async');
        if (node.value.isOptional) parts.push('optional');
        if (parts.length) label += ' (' + parts.join(', ') + ')';
        if (node.value.env) label += ` (${getEnvDescription(node.value.env)})`;
      } else if (node.type === 'asset' || node.type === 'asset_reference') {
        label += path.basename(node.value.filePath) + '#' + node.value.type;
      } else if (node.type === 'file') {
        label += path.basename(node.value.filePath);
      } else if (node.type === 'transformer_request') {
        label +=
          path.basename(node.value.filePath) +
          ` (${getEnvDescription(node.value.env)})`;
      } else if (node.type === 'bundle') {
        let rootAssets = node.value.assetGraph.getEntryAssets();
        label += rootAssets
          .map(asset => {
            let parts = asset.filePath.split(path.sep);
            let index = parts.lastIndexOf('node_modules');
            if (index >= 0) {
              return parts[index + 1];
            }

            return path.basename(asset.filePath);
          })
          .join(', ');
      } else {
        // label += node.id;
        label = node.type;
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

function getEnvDescription(env: Environment) {
  let description = '';
  if (env.engines.browsers) {
    description = `${env.context}: ${env.engines.browsers.join(', ')}`;
  } else if (env.engines.node) {
    description = `node: ${env.engines.node}`;
  }

  return description;
}
