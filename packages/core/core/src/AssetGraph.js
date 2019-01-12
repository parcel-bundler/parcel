// @flow
'use strict';
import Graph, {Node, type NodeId} from './Graph';
import type {
  CacheEntry,
  Dependency as IDependency,
  Asset,
  File,
  FilePath,
  TransformerRequest,
  Target,
  Environment,
  Bundle,
  GraphTraversalCallback,
  DependencyResolution
} from '@parcel/types';
import md5 from '@parcel/utils/md5';
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

const getFileNodesFromGraph = (graph: Graph): Array<Node> => {
  return Array.from(graph.nodes.values()).filter(
    (node: any) => node.type === 'file'
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
  newRequest?: TransformerRequest,
  prunedFiles: Array<File>
};

type FileUpdates = {
  newDeps: Array<Dependency>,
  addedFiles: Array<File>,
  removedFiles: Array<File>
};

type AssetGraphOpts = {
  entries: Array<string>,
  targets: Array<Target>,
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

  constructor(opts: any) {
    super(opts);
    this.incompleteNodes = new Map();
    this.invalidNodes = new Map();
  }

  initializeGraph({entries, targets, rootDir}: AssetGraphOpts) {
    let rootNode = nodeFromRootDir(rootDir);
    this.setRootNode(rootNode);

    let depNodes = [];
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

        depNodes.push(node);
      }
    }

    this.replaceNodesConnectedTo(rootNode, depNodes);
    for (let depNode of depNodes) {
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
    let newDepNodes: Array<Node> = [];

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

  getDependencies(asset: Asset): Array<IDependency> {
    let node = this.getNode(asset.id);
    if (!node) {
      return [];
    }

    return this.getNodesConnectedFrom(node).map(node => node.value);
  }

  getDependencyResolution(dep: IDependency): DependencyResolution {
    let depNode = this.getNode(dep.id);
    if (!depNode) {
      return {};
    }

    let node = this.getNodesConnectedFrom(depNode)[0];
    if (!node) {
      return {};
    }

    if (node.type === 'transformer_request') {
      let assetNode = this.getNodesConnectedFrom(node).find(
        node => node.type === 'asset' || node.type === 'asset_reference'
      );
      if (assetNode) {
        return {asset: assetNode.value};
      }
    } else if (node.type === 'bundle_group') {
      let bundles = this.getNodesConnectedFrom(node).map(node => node.value);
      return {bundles};
    }

    return {};
  }

  traverseAssets(visit: GraphTraversalCallback<Asset>, startNode: ?Node) {
    return this.traverse((node, ...args) => {
      if (node.type === 'asset') {
        return visit(node.value, ...args);
      }
    }, startNode);
  }

  createBundle(asset: Asset): Bundle {
    let assetNode = this.getNode(asset.id);
    if (!assetNode) {
      throw new Error('Cannot get bundle for non-existant asset');
    }

    let graph = this.getSubGraph(assetNode);
    graph.setRootNode({
      type: 'root',
      id: 'root',
      value: null
    });

    graph.addEdge({from: 'root', to: assetNode.id});
    return {
      id: 'bundle:' + asset.id,
      type: asset.type,
      assetGraph: graph
    };
  }

  getTotalSize(asset?: Asset): number {
    let size = 0;
    let assetNode = asset ? this.getNode(asset.id) : null;
    this.traverseAssets(asset => {
      size += asset.outputSize;
    }, assetNode);

    return size;
  }

  getEntryAssets(): Array<Asset> {
    let root = this.getRootNode();
    if (!root) {
      return [];
    }

    return this.getNodesConnectedFrom(root).map(node => node.value);
  }

  removeAsset(asset: Asset) {
    let assetNode = this.getNode(asset.id);
    if (!assetNode) {
      return;
    }

    this.replaceNode(assetNode, {
      type: 'asset_reference',
      id: 'asset_reference:' + assetNode.id,
      value: asset
    });
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
      transformer_request: 'cyan',
      file: 'gray',
      default: 'white'
    };

    let nodes = Array.from(this.nodes.values());

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
        let rootAssets = node.value.assetGraph.getNodesConnectedFrom(
          node.value.assetGraph.getRootNode()
        );
        label += rootAssets
          .map(asset => {
            let parts = asset.value.filePath.split(path.sep);
            let index = parts.lastIndexOf('node_modules');
            if (index >= 0) {
              return parts[index + 1];
            }

            return path.basename(asset.value.filePath);
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
