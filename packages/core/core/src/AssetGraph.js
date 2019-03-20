// @flow strict-local

import type {
  AssetGraphNode,
  DependencyNode,
  FileNode,
  NodeId,
  RootNode
} from './types';

import type {
  Asset,
  CacheEntry,
  Dependency as IDependency,
  File,
  FilePath,
  GraphTraversalCallback,
  Target,
  TransformerRequest
} from '@parcel/types';

import invariant from 'assert';
import Graph from './Graph';
import {md5FromString} from '@parcel/utils/src/md5';
import {isGlob} from '@parcel/utils/src/glob';
import {isMatch} from 'micromatch';
import Dependency from './Dependency';

export const nodeFromRootDir = (rootDir: string): RootNode => ({
  id: rootDir,
  type: 'root',
  value: rootDir
});

export const nodeFromDep = (dep: IDependency): DependencyNode => ({
  id: dep.id,
  type: 'dependency',
  value: dep
});

export const nodeFromFile = (file: File): FileNode => ({
  id: file.filePath,
  type: 'file',
  value: file
});

export const nodeFromGlob = (glob: string) => ({
  id: glob,
  type: 'glob',
  value: glob
});

export const nodeFromTransformerRequest = (req: TransformerRequest) => ({
  id: md5FromString(`${req.filePath}:${JSON.stringify(req.env)}`),
  type: 'transformer_request',
  value: req
});

export const nodeFromAsset = (asset: Asset) => ({
  id: asset.id,
  type: 'asset',
  value: asset
});

export const nodeFromConfigRequest = req => ({
  id: md5FromString(`${req.filePath}:${req.plugin}`),
  type: 'config_request',
  value: req
});

export const nodeFromConfig = config => ({
  id: md5FromString(
    `${config.resolveFrom}:${config.contentHash || config.content}`
  ),
  type: 'config',
  value: config
});

export const nodeFromDevDepRequest = devDepRequest => ({
  id: md5FromString(JSON.stringify(devDepRequest)),
  type: 'dev_dep_request',
  value: devDepRequest
});

export const nodeFromDevDep = devDep => ({
  id: md5FromString(`${devDep.name}:${devDep.version}`),
  type: 'dev_dep',
  value: devDep
});

const getFileNodesFromGraph = (
  graph: Graph<AssetGraphNode>
): Array<FileNode> => {
  // $FlowFixMe Flow can't refine on filter https://github.com/facebook/flow/issues/1414
  return Array.from(graph.nodes.values()).filter(node => node.type === 'file');
};

const getFilesFromGraph = (graph: Graph<AssetGraphNode>): Array<File> => {
  return getFileNodesFromGraph(graph).map(node => node.value);
};

const getDepNodesFromGraph = (
  graph: Graph<AssetGraphNode>
): Array<DependencyNode> => {
  // $FlowFixMe Flow can't refine on filter https://github.com/facebook/flow/issues/1414
  return Array.from(graph.nodes.values()).filter(
    node => node.type === 'dependency'
  );
};

type DepUpdates = {|
  newRequest?: TransformerRequest,
  prunedFiles: Array<File>
|};

type FileUpdates = {|
  newDeps: Array<IDependency>,
  addedFiles: Array<File>,
  removedFiles: Array<File>
|};

type AssetGraphOpts = {|
  entries?: Array<string>,
  targets?: Array<Target>,
  transformerRequest?: TransformerRequest,
  rootDir: string
|};

/**
 * AssetGraph is a Graph with some extra rules.
 *  * Nodes can only have one of the following types "root", "dependency", "file", "asset"
 *  * There is one root node that represents the root directory
 *  * The root note has edges to dependency nodes for each entry file
 *  * A dependency node should have an edge to exactly one file node
 *  * A file node can have one to many edges to asset nodes which can have zero to many edges dependency nodes
 */
export default class AssetGraph extends Graph<AssetGraphNode> {
  incompleteNodes: Map<NodeId, AssetGraphNode> = new Map();
  invalidNodes: Map<NodeId, AssetGraphNode> = new Map();

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

  removeNode(node: AssetGraphNode): this {
    this.incompleteNodes.delete(node.id);
    return super.removeNode(node);
  }

  /**
   * Marks a dependency as resolved, and connects it to a transformer
   * request node for the file it was resolved to.
   */
  resolveDependency(dep: IDependency, req: TransformerRequest): DepUpdates {
    let newRequestNode;

    let depNode = nodeFromDep(dep);
    this.incompleteNodes.delete(depNode.id);
    this.invalidNodes.delete(depNode.id);

    let requestNode = nodeFromTransformerRequest(req);
    let {added, removed} = this.replaceNodesConnectedTo(depNode, [requestNode]);

    if (added.nodes.size) {
      newRequestNode = requestNode;
      this.incompleteNodes.set(requestNode.id, requestNode);
    }

    let prunedFiles = getFilesFromGraph(removed);
    return {newRequestNode, prunedFiles};
  }

  /**
   * Marks a transformer request as resolved, and connects it to asset and file
   * nodes for the generated assets and connected files.
   */
  resolveTransformerRequest(
    req: TransformerRequest,
    assets: Array<Asset>
  ): FileUpdates {
    let newDepNodes: Array<DependencyNode> = [];

    let requestNode = nodeFromTransformerRequest(req);
    this.incompleteNodes.delete(requestNode.id);
    this.invalidNodes.delete(requestNode.id);

    // Get connected files from each asset and connect them to the file node
    let fileNodes = [];
    // TODO: Reimplement connected files, they should now only be used for source files (not config)
    // for (let asset of cacheEntry.assets) {
    //   let files = asset.getConnectedFiles().map(file => nodeFromFile(file));
    //   fileNodes = fileNodes.concat(files);
    // }

    // Add a file node for the file that the transformer request resolved to
    fileNodes.push(
      nodeFromFile({
        filePath: req.filePath
      })
    );

    let assetNodes = assets.map(asset => nodeFromAsset(asset));
    this.replaceNodesConnectedTo(requestNode, assetNodes, 'produces');
    this.replaceNodesConnectedTo(
      requestNode,
      fileNodes,
      'invalidated_by_change_to'
    );

    for (let assetNode of assetNodes) {
      let depNodes = assetNode.value
        .getDependencies()
        .map(dep => nodeFromDep(dep));
      let {removed, added} = this.replaceNodesConnectedTo(assetNode, depNodes);
      newDepNodes = newDepNodes.concat(getDepNodesFromGraph(added));
    }

    for (let depNode of newDepNodes) {
      this.incompleteNodes.set(depNode.id, depNode);
    }

    return {newDepNodes};
  }

  addConfigRequest(configRequestNode, node: AssetGraphNode) {
    if (!this.nodes.has(configRequestNode.id)) {
      this.addNode(configRequestNode);
      this.addEdge({from: node.id, to: configRequestNode.id});
    }

    return configRequestNode;
  }

  resolveConfigRequest(config, configRequestNode) {
    this.incompleteNodes.delete(configRequestNode.id);
    this.invalidNodes.delete(configRequestNode.id);
    let configNode = nodeFromConfig(config);
    this.replaceNodesConnectedTo(configRequestNode, [configNode], 'produces');

    let invalidationConnections = {
      invalidated_by_change_to: [],
      invalidated_by_addition_matching: [],
      invalidated_by_removal_of: []
    };
    for (let {action, pattern} of config.getInvalidations()) {
      let invalidateNode = isGlob(pattern)
        ? nodeFromGlob(pattern)
        : nodeFromFile({filePath: pattern});

      let edgeType = getInvalidationEdgeType(action);
      invalidationConnections[edgeType].push(invalidateNode);
    }

    for (let [edgeType, nodes] of Object.entries(invalidationConnections)) {
      this.replaceNodesConnectedTo(configRequestNode, nodes, edgeType);
    }

    let devDepRequestNodes = [];
    for (let devDepRequest of config.getDevDepRequests()) {
      let devDepRequestNode = nodeFromDevDepRequest(devDepRequest);
      devDepRequestNodes.push(devDepRequestNode);
    }

    this.replaceNodesConnectedTo(
      configRequestNode,
      devDepRequestNodes,
      'spawns'
    );

    return {devDepRequestNodes};
  }

  resolveDevDepRequest(devDepRequestNode, devDep, actionNode) {
    this.incompleteNodes.delete(devDepRequestNode.id);
    this.invalidNodes.delete(devDepRequestNode.id);
    let devDepNode = nodeFromDevDep(devDep);
    this.addNode(devDepNode);
    let edge = {
      from: devDepRequestNode.id,
      to: devDepNode.id,
      type: 'resolves_to'
    };
    if (!this.hasEdge(edge)) {
      this.addEdge(edge);
    }
  }

  getDependencies(asset: Asset): Array<IDependency> {
    let node = this.getNode(asset.id);
    if (!node) {
      return [];
    }

    return this.getNodesConnectedFrom(node).map(node => {
      invariant(node.type === 'dependency');
      return node.value;
    });
  }

  getDependencyResolution(dep: IDependency): ?Asset {
    let depNode = this.getNode(dep.id);
    if (!depNode) {
      return null;
    }

    let res: ?Asset = null;
    this.traverse((node, ctx, traversal) => {
      // Prefer real assets when resolving dependencies, but use the first
      // asset reference in absence of a real one.
      if (node.type === 'asset_reference' && !res) {
        res = node.value;
      }

      if (node.type === 'asset') {
        res = node.value;
        traversal.stop();
      }
    }, depNode);

    return res;
  }

  traverseAssets(
    visit: GraphTraversalCallback<Asset, AssetGraphNode>,
    startNode: ?AssetGraphNode
  ): ?AssetGraphNode {
    return this.traverse((node, ...args) => {
      if (node.type === 'asset') {
        return visit(node.value, ...args);
      }
    }, startNode);
  }

  getTotalSize(asset?: ?Asset): number {
    let size = 0;
    let assetNode = asset ? this.getNode(asset.id) : null;
    this.traverseAssets(asset => {
      size += asset.stats.size;
    }, assetNode);

    return size;
  }

  getEntryAssets(): Array<Asset> {
    let entries = [];
    this.traverseAssets((asset, ctx, traversal) => {
      entries.push(asset);
      traversal.skipChildren();
    });

    return entries;
  }

  removeAsset(asset: Asset): ?NodeId {
    let assetNode = this.getNode(asset.id);
    if (!assetNode) {
      return;
    }

    let referenceId = 'asset_reference:' + assetNode.id;
    this.replaceNode(assetNode, {
      type: 'asset_reference',
      id: referenceId,
      value: asset
    });

    return referenceId;
  }

  getGlobNodesFromGraph() {
    return Array.from(this.nodes.values()).filter(node => node.type === 'glob');
  }

  getFileNodesFromGraph() {
    return Array.from(this.nodes.values()).filter(node => node.type === 'file');
  }

  respondToFSChange({action, path}) {
    console.log('RESPONDING TO FS CHANGE', action, path);
    let edgeType = getInvalidationEdgeType(action);

    let fileNode = this.nodes.get(path);
    if (fileNode) {
      this.invalidateConnectedNodes(fileNode, edgeType);
    }

    if (action === 'add') {
      for (let globNode of this.getGlobNodesFromGraph()) {
        if (isMatch(path, globNode.value)) {
          this.invalidateConnectedNodes(globNode, edgeType);
        }
      }
    }
  }

  invalidateConnectedNodes(node, edgeType) {
    let nodesToInvalidate = this.getNodesConnectedTo(node, edgeType);
    for (let nodeToInvalidate of nodesToInvalidate) {
      this.invalidateNode(nodeToInvalidate);
    }
  }

  invalidateNode(node: AssetGraphNode) {
    switch (node.type) {
      case 'transformer_request':
      case 'dependency':
        this.invalidNodes.set(node.id, node);
        break;
      case 'config_request':
      case 'dev_dep_request':
        this.invalidNodes.set(node.id, node);
        let actionNode = this.getActionNode(node);
        this.invalidNodes.set(actionNode.id, actionNode);
        break;
      default:
        throw new Error(
          `Cannot invalidate node with unrecognized type ${node.type}`
        );
    }
  }

  getActionNode(node: AssetGraphNode) {
    if (node.type === 'dev_dep_request') {
      let [configRequestNode] = this.getNodesConnectedTo(node);
      let [actionNode] = this.getNodesConnectedTo(configRequestNode);
      return actionNode;
    } else if (node.type === 'config_request') {
      let [actionNode] = this.getNodesConnectedTo(node);
      return actionNode;
    }
  }
}

function getInvalidationEdgeType(eventType) {
  switch (eventType) {
    case 'change':
      return 'invalidated_by_change_to';
    case 'add':
      return 'invalidated_by_addition_matching';
    case 'unlink':
      return 'invalidated_by_removal_of';
    default:
      throw new Error(`Unrecognized invalidation event type "${eventType}"`);
  }
}
