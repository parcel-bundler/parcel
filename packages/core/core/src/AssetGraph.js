// @flow strict-local

import type {GraphVisitor, FilePath} from '@parcel/types';
import type {
  Asset,
  AssetGraphNode,
  AssetGroup,
  AssetGroupNode,
  Dependency,
  DependencyNode,
  NodeId,
  Target
} from './types';

import invariant from 'assert';
import crypto from 'crypto';
import {md5FromObject} from '@parcel/utils';
import Graph, {type GraphOpts} from './Graph';
import {createDependency} from './Dependency';

type AssetGraphOpts = {|
  ...GraphOpts<AssetGraphNode>,
  onNodeAdded?: (node: AssetGraphNode) => mixed,
  onNodeRemoved?: (node: AssetGraphNode) => mixed
|};

type InitOpts = {|
  entries?: Array<string>,
  targets?: Array<Target>,
  assetGroups?: Array<AssetGroup>
|};

type SerializedAssetGraph = {|
  ...GraphOpts<AssetGraphNode>,
  hash: ?string
|};

const nodeFromDep = (dep: Dependency): DependencyNode => ({
  id: dep.id,
  type: 'dependency',
  value: dep
});

export const nodeFromAssetGroup = (
  assetGroup: AssetGroup,
  deferred: boolean = false
) => ({
  id: md5FromObject(assetGroup),
  type: 'asset_group',
  value: assetGroup,
  deferred
});

const nodeFromAsset = (asset: Asset) => ({
  id: asset.id,
  type: 'asset',
  value: asset
});

const nodeFromEntrySpecifier = (entry: string) => ({
  id: 'entry_specifier:' + entry,
  type: 'entry_specifier',
  value: entry
});

const nodeFromEntryFile = (entry: string) => ({
  id: 'entry_file:' + entry,
  type: 'entry_file',
  value: entry
});

// Types that are considered incomplete when they don't have a child node
const INCOMPLETE_TYPES = [
  'entry_specifier',
  'entry_file',
  'dependency',
  'asset_group'
];

export default class AssetGraph extends Graph<AssetGraphNode> {
  onNodeAdded: ?(node: AssetGraphNode) => mixed;
  onNodeRemoved: ?(node: AssetGraphNode) => mixed;
  incompleteNodeIds: Set<NodeId> = new Set();
  hash: ?string;

  // $FlowFixMe
  static deserialize(opts: SerializedAssetGraph): AssetGraph {
    let res = new AssetGraph(opts);
    res.incompleteNodeIds = opts.incompleteNodeIds;
    res.hash = opts.hash;
    return res;
  }

  // $FlowFixMe
  serialize(): SerializedAssetGraph {
    return {
      ...super.serialize(),
      incompleteNodeIds: this.incompleteNodeIds,
      hash: this.hash
    };
  }

  initOptions({onNodeAdded, onNodeRemoved}: AssetGraphOpts = {}) {
    this.onNodeAdded = onNodeAdded;
    this.onNodeRemoved = onNodeRemoved;
  }

  initialize({entries, assetGroups}: InitOpts) {
    let rootNode = {id: '@@root', type: 'root', value: null};
    this.setRootNode(rootNode);

    let nodes = [];
    if (entries) {
      for (let entry of entries) {
        let node = nodeFromEntrySpecifier(entry);
        nodes.push(node);
      }
    } else if (assetGroups) {
      nodes.push(
        ...assetGroups.map(assetGroup => nodeFromAssetGroup(assetGroup))
      );
    }
    this.replaceNodesConnectedTo(rootNode, nodes);
  }

  addNode(node: AssetGraphNode) {
    this.hash = null;
    let existingNode = this.getNode(node.id);
    if (
      INCOMPLETE_TYPES.includes(node.type) &&
      !node.deferred &&
      (!existingNode || existingNode.deferred)
    ) {
      this.incompleteNodeIds.add(node.id);
    }
    this.onNodeAdded && this.onNodeAdded(node);
    return super.addNode(node);
  }

  removeNode(node: AssetGraphNode) {
    this.hash = null;
    this.incompleteNodeIds.delete(node.id);
    this.onNodeRemoved && this.onNodeRemoved(node);
    return super.removeNode(node);
  }

  hasIncompleteNodes() {
    return this.incompleteNodeIds.size > 0;
  }

  resolveEntry(entry: string, resolved: Array<FilePath>) {
    let entrySpecifierNode = nodeFromEntrySpecifier(entry);
    let entryFileNodes = resolved.map(file => nodeFromEntryFile(file));
    this.replaceNodesConnectedTo(entrySpecifierNode, entryFileNodes);
    this.incompleteNodeIds.delete(entrySpecifierNode.id);
  }

  resolveTargets(entryFile: FilePath, targets: Array<Target>) {
    let depNodes = targets.map(target =>
      nodeFromDep(
        createDependency({
          moduleSpecifier: entryFile,
          pipeline: target.name,
          target: target,
          env: target.env,
          isEntry: true
        })
      )
    );

    let entryNode = nodeFromEntryFile(entryFile);
    if (this.hasNode(entryNode.id)) {
      this.replaceNodesConnectedTo(entryNode, depNodes);
      this.incompleteNodeIds.delete(entryNode.id);
    }
  }

  resolveDependency(
    dependency: Dependency,
    assetGroupNode: AssetGroupNode | null
  ) {
    let depNode = this.nodes.get(dependency.id);
    if (!depNode) return;
    this.incompleteNodeIds.delete(depNode.id);

    if (assetGroupNode) {
      this.replaceNodesConnectedTo(depNode, [assetGroupNode]);
    }
  }

  resolveAssetGroup(assetGroup: AssetGroup, assets: Array<Asset>) {
    let assetGroupNode = nodeFromAssetGroup(assetGroup);
    this.incompleteNodeIds.delete(assetGroupNode.id);
    if (!this.hasNode(assetGroupNode.id)) {
      return;
    }

    let assetNodes = assets.map(asset => nodeFromAsset(asset));
    this.replaceNodesConnectedTo(assetGroupNode, assetNodes);

    for (let assetNode of assetNodes) {
      let depNodes = [];
      invariant(assetNode.type === 'asset');
      for (let dep of assetNode.value.dependencies.values()) {
        let depNode = nodeFromDep(dep);
        depNodes.push(this.nodes.get(depNode.id) || depNode);
      }
      this.replaceNodesConnectedTo(assetNode, depNodes);
    }
  }

  getIncomingDependencies(asset: Asset): Array<Dependency> {
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
    return this.filteredTraverse(
      node => (node.type === 'asset' ? node.value : null),
      visit,
      startNode
    );
  }

  getEntryAssetGroupNodes(): Array<AssetGroupNode> {
    let entryNodes = [];
    this.traverse((node, _, actions) => {
      if (node.type === 'asset_group') {
        entryNodes.push(node);
        actions.skipChildren();
      }
    });
    return entryNodes;
  }

  getEntryAssets(): Array<Asset> {
    let entries = [];
    this.traverseAssets((asset, ctx, traversal) => {
      entries.push(asset);
      traversal.skipChildren();
    });

    return entries;
  }

  getHash() {
    if (this.hash != null) {
      return this.hash;
    }

    let hash = crypto.createHash('md5');
    // TODO: sort??
    this.traverse(node => {
      if (node.type === 'asset') {
        hash.update(node.value.outputHash);
      } else if (node.type === 'dependency' && node.value.target) {
        hash.update(JSON.stringify(node.value.target));
      }
    });

    this.hash = hash.digest('hex');
    return this.hash;
  }
}
