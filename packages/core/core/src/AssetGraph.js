// @flow strict-local

import invariant from 'assert';
import nullthrows from 'nullthrows';

import type {GraphVisitor, FilePath} from '@parcel/types';
import type {Target} from './types';
import {md5FromObject} from '@parcel/utils';

import type {Asset, Dependency} from './types';
import Graph, {type GraphOpts} from './Graph';
import type {AssetGraphNode, AssetGroup, DependencyNode} from './types';
import crypto from 'crypto';
import {createDependency} from './Dependency';

type AssetGraphOpts = {|
  ...GraphOpts<AssetGraphNode>,
  onNodeAdded?: (node: AssetGraphNode) => mixed,
  onNodeRemoved?: (node: AssetGraphNode) => mixed
|};

type InitOpts = {|
  entries?: Array<string>,
  targets?: Array<Target>,
  assetGroup?: AssetGroup
|};

type SerializedAssetGraph = {|
  ...GraphOpts<AssetGraphNode>,
  hash: ?string
|};

const invertMap = <K, V>(map: Map<K, V>): Map<V, K> =>
  new Map([...map].map(([key, val]) => [val, key]));

const nodeFromDep = (dep: Dependency): DependencyNode => ({
  id: dep.id,
  type: 'dependency',
  value: dep
});

export const nodeFromAssetGroup = (assetGroup: AssetGroup) => ({
  id: md5FromObject(assetGroup),
  type: 'asset_group',
  value: assetGroup
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

export default class AssetGraph extends Graph<AssetGraphNode> {
  onNodeAdded: ?(node: AssetGraphNode) => mixed;
  onNodeRemoved: ?(node: AssetGraphNode) => mixed;
  hash: ?string;

  // $FlowFixMe
  static deserialize(opts: SerializedAssetGraph): AssetGraph {
    let res = new AssetGraph(opts);
    res.hash = opts.hash;
    return res;
  }

  // $FlowFixMe
  serialize(): SerializedAssetGraph {
    return {
      ...super.serialize(),
      hash: this.hash
    };
  }

  initOptions({onNodeAdded, onNodeRemoved}: AssetGraphOpts = {}) {
    this.onNodeAdded = onNodeAdded;
    this.onNodeRemoved = onNodeRemoved;
  }

  initialize({entries, assetGroup}: InitOpts) {
    let rootNode = {id: '@@root', type: 'root', value: null};
    this.setRootNode(rootNode);

    let nodes = [];
    if (entries) {
      for (let entry of entries) {
        let node = nodeFromEntrySpecifier(entry);
        nodes.push(node);
      }
    } else if (assetGroup) {
      let node = nodeFromAssetGroup(assetGroup);
      nodes.push(node);
    }

    this.replaceNodesConnectedTo(rootNode, nodes);
  }

  addNode(node: AssetGraphNode) {
    this.hash = null;
    this.onNodeAdded && this.onNodeAdded(node);
    return super.addNode(node);
  }

  removeNode(node: AssetGraphNode) {
    this.hash = null;
    this.onNodeRemoved && this.onNodeRemoved(node);
    return super.removeNode(node);
  }

  resolveEntry(entry: string, resolved: Array<FilePath>) {
    let entryFileNodes = resolved.map(file => nodeFromEntryFile(file));
    this.replaceNodesConnectedTo(nodeFromEntrySpecifier(entry), entryFileNodes);
  }

  resolveTargets(entryFile: FilePath, targets: Array<Target>) {
    let depNodes = targets.map(target =>
      nodeFromDep(
        createDependency({
          moduleSpecifier: entryFile,
          target: target,
          env: target.env,
          isEntry: true
        })
      )
    );

    this.replaceNodesConnectedTo(nodeFromEntryFile(entryFile), depNodes);
  }

  resolveDependency(dependency: Dependency, assetGroup: AssetGroup | null) {
    if (!assetGroup) return;

    let depNode = nullthrows(this.nodes.get(dependency.id));
    let assetGroupNode = nodeFromAssetGroup(assetGroup);

    // Defer transforming this dependency if it is marked as weak, there are no side effects,
    // and no re-exported symbols are used by ancestor dependencies.
    // This helps with performance building large libraries like `lodash-es`, which re-exports
    // a huge number of functions since we can avoid even transforming the files that aren't used.
    let defer = false;
    if (dependency.isWeak && assetGroup.sideEffects === false) {
      let assets = this.getNodesConnectedTo(depNode);
      let symbols = invertMap(dependency.symbols);
      let firstAsset = assets[0];
      invariant(firstAsset.type === 'asset');
      let resolvedAsset = firstAsset.value;
      let deps = this.getIncomingDependencies(resolvedAsset);
      defer = deps.every(
        d =>
          !d.symbols.has('*') &&
          ![...d.symbols.keys()].some(symbol => {
            let assetSymbol = resolvedAsset.symbols.get(symbol);
            return assetSymbol != null && symbols.has(assetSymbol);
          })
      );
    }

    if (!defer) {
      this.replaceNodesConnectedTo(depNode, [assetGroupNode]);
    }
  }

  resolveAssetGroup(assetGroup: AssetGroup, assets: Array<Asset>) {
    let assetGroupNode = nodeFromAssetGroup(assetGroup);
    assetGroupNode = nullthrows(this.nodes.get(assetGroupNode.id));

    let assetNodes = [];
    for (let asset of assets) {
      let assetNode = nodeFromAsset(asset);
      assetNodes.push(assetNode);
      let depNodes = [];
      for (let dep of asset.dependencies.values()) {
        let depNode = nodeFromDep(dep);
        depNodes.push(this.nodes.get(depNode.id) || depNode);
      }
      this.replaceNodesConnectedTo(assetNode, depNodes);
    }
    this.replaceNodesConnectedTo(assetGroupNode, assetNodes);
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
