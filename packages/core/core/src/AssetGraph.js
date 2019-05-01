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
  Target,
  GraphVisitor,
  Symbol,
  SymbolResolution,
  TransformerRequest
} from '@parcel/types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import Graph from './Graph';
import {md5FromString} from '@parcel/utils/src/md5';
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

const invertMap = <K, V>(map: Map<K, V>): Map<V, K> =>
  new Map([...map].map(([key, val]) => [val, key]));

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
  deferredNodes: Set<NodeId> = new Set();

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
    let newRequest;

    let depNode = nodeFromDep(dep);
    this.incompleteNodes.delete(depNode.id);
    this.invalidNodes.delete(depNode.id);

    let requestNode = nodeFromTransformerRequest(req);
    let {added, removed} = this.replaceNodesConnectedTo(depNode, [requestNode]);

    // Defer transforming this dependency if it is marked as weak, there are no side effects,
    // and no re-exported symbols are used by ancestor dependencies.
    // This helps with performance building large libraries like `lodash-es`, which re-exports
    // a huge number of functions since we can avoid even transforming the files that aren't used.
    let defer = false;
    if (dep.isWeak && req.sideEffects === false) {
      let assets = this.getNodesConnectedTo(depNode);
      let symbols = invertMap(dep.symbols);
      invariant(
        assets[0].type === 'asset' || assets[0].type === 'asset_reference'
      );
      let resolvedAsset = assets[0].value;
      let deps = this.getAncestorDependencies(resolvedAsset);
      defer = deps.every(
        d =>
          !d.symbols.has('*') &&
          ![...d.symbols.keys()].some(symbol => {
            let assetSymbol = resolvedAsset.symbols.get(symbol);
            return assetSymbol != null && symbols.has(assetSymbol);
          })
      );
    }

    if (added.nodes.size) {
      this.deferredNodes.add(requestNode.id);
    }

    if (!defer && this.deferredNodes.has(requestNode.id)) {
      newRequest = req;
      this.incompleteNodes.set(requestNode.id, requestNode);
      this.deferredNodes.delete(requestNode.id);
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
      let files = asset.getConnectedFiles().map(file => nodeFromFile(file));
      fileNodes = fileNodes.concat(files);
    }

    // Add a file node for the file that the transformer request resolved to
    fileNodes.push(
      nodeFromFile({
        filePath: req.filePath
      })
    );

    let assetNodes = cacheEntry.assets.map(asset => nodeFromAsset(asset));
    let {added, removed} = this.replaceNodesConnectedTo(requestNode, [
      ...assetNodes,
      ...fileNodes
    ]);

    let addedFiles = getFilesFromGraph(added);
    let removedFiles = getFilesFromGraph(removed);

    for (let assetNode of assetNodes) {
      let depNodes = assetNode.value.getDependencies().map(dep => {
        let node = this.getNode(dep.id);
        if (node && node.type === 'dependency') {
          node.value.merge(dep);
          return node;
        }

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

  invalidateNode(node: AssetGraphNode) {
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
      if (node.type === 'asset' || node.type === 'asset_reference') {
        res = node.value;
        traversal.stop();
      }
    }, depNode);

    return res;
  }

  getAncestorDependencies(asset: Asset): Array<IDependency> {
    let node = this.getNode(asset.id);
    if (!node) {
      return [];
    }

    return this.findAncestors(node, node => node.type === 'dependency').map(
      node => {
        invariant(node.type === 'dependency');
        return node.value;
      }
    );
  }

  traverseAssets<TContext>(
    visit: GraphVisitor<Asset, TContext>,
    startNode: ?AssetGraphNode
  ): ?TContext {
    return this.traverse(
      {
        enter: (node, ...args) => {
          let fn = visit.enter || visit;
          if (node.type === 'asset' && typeof fn === 'function') {
            return fn(node.value, ...args);
          }
        },
        exit: (node, ...args) => {
          if (node.type === 'asset' && typeof visit.exit === 'function') {
            return visit.exit(node.value, ...args);
          }
        }
      },
      startNode
    );
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

  removeAsset(asset: Asset): void {
    let assetNode = this.getNode(asset.id);
    if (!assetNode) {
      return;
    }

    asset.meta.isReferenced = true; // FIXME
    this.replaceNode(assetNode, {
      type: 'asset_reference',
      id: 'asset_reference:' + assetNode.id,
      value: asset
    });
  }

  resolveSymbol(asset: Asset, symbol: Symbol): SymbolResolution {
    if (symbol === '*') {
      return {asset, exportSymbol: '*', symbol: '*'};
    }

    let identifier = asset.symbols.get(symbol);

    let deps = this.getDependencies(asset).reverse();
    for (let dep of deps) {
      // If this is a re-export, find the original module.
      let symbolLookup = new Map(
        [...dep.symbols].map(([key, val]) => [val, key])
      );
      let depSymbol = symbolLookup.get(identifier);
      if (depSymbol != null) {
        let resolved = nullthrows(this.getDependencyResolution(dep));
        return this.resolveSymbol(resolved, depSymbol);
      }

      // If this module exports wildcards, resolve the original module.
      // Default exports are excluded from wildcard exports.
      if (dep.symbols.get('*') === '*' && symbol !== 'default') {
        let resolved = nullthrows(this.getDependencyResolution(dep));
        let result = this.resolveSymbol(resolved, symbol);
        if (result.symbol != null) {
          return result;
        }
      }
    }

    return {asset, exportSymbol: symbol, symbol: identifier};
  }
}
