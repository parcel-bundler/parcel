// @flow strict-local

import type {GraphVisitor} from '@parcel/types';
import type {
  Asset,
  AssetGraphNode,
  AssetGroup,
  AssetGroupNode,
  AssetNode,
  Dependency,
  DependencyNode,
  Entry,
  EntryFileNode,
  EntrySpecifierNode,
  Target,
} from './types';

import invariant from 'assert';
import crypto from 'crypto';
import {md5FromObject} from '@parcel/utils';
import nullthrows from 'nullthrows';
import Graph, {type GraphOpts} from './Graph';
import {createDependency} from './Dependency';

type AssetGraphOpts = {|
  ...GraphOpts<AssetGraphNode>,
  onNodeRemoved?: (node: AssetGraphNode) => mixed,
|};

type InitOpts = {|
  entries?: Array<string>,
  targets?: Array<Target>,
  assetGroups?: Array<AssetGroup>,
|};

type SerializedAssetGraph = {|
  ...GraphOpts<AssetGraphNode>,
  hash?: ?string,
|};

export function nodeFromDep(dep: Dependency): DependencyNode {
  return {
    id: dep.id,
    type: 'dependency',
    value: dep,
  };
}

export function nodeFromAssetGroup(assetGroup: AssetGroup): AssetGroupNode {
  return {
    id: md5FromObject({
      ...assetGroup,
      // only influences building the asset graph
      canDefer: undefined,
      // if only the isURL property is different, no need to re-run transformation.
      isURL: undefined,
    }),
    type: 'asset_group',
    value: assetGroup,
  };
}

export function nodeFromAsset(asset: Asset): AssetNode {
  return {
    id: asset.id,
    type: 'asset',
    value: asset,
  };
}

export function nodeFromEntrySpecifier(entry: string): EntrySpecifierNode {
  return {
    id: 'entry_specifier:' + entry,
    type: 'entry_specifier',
    value: entry,
  };
}

export function nodeFromEntryFile(entry: Entry): EntryFileNode {
  return {
    id: 'entry_file:' + md5FromObject(entry),
    type: 'entry_file',
    value: entry,
  };
}

export default class AssetGraph extends Graph<AssetGraphNode> {
  onNodeRemoved: ?(node: AssetGraphNode) => mixed;
  hash: ?string;

  constructor(opts: ?SerializedAssetGraph) {
    if (opts) {
      let {hash, ...rest} = opts;
      super(rest);
      this.hash = hash;
    } else {
      super();
    }
  }

  // $FlowFixMe
  static deserialize(opts: SerializedAssetGraph): AssetGraph {
    return new AssetGraph(opts);
  }

  // $FlowFixMe
  serialize(): SerializedAssetGraph {
    // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
    return {
      ...super.serialize(),
      hash: this.hash,
    };
  }

  initOptions({onNodeRemoved}: AssetGraphOpts = {}) {
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
        ...assetGroups.map(assetGroup => nodeFromAssetGroup(assetGroup)),
      );
    }
    this.replaceNodesConnectedTo(rootNode, nodes);
  }

  addNode(node: AssetGraphNode): AssetGraphNode {
    this.hash = null;
    return super.addNode(node);
  }

  removeNode(node: AssetGraphNode): void {
    this.hash = null;
    this.onNodeRemoved && this.onNodeRemoved(node);
    return super.removeNode(node);
  }

  resolveEntry(
    entry: string,
    resolved: Array<Entry>,
    correspondingRequest: string,
  ) {
    let entrySpecifierNode = nullthrows(
      this.getNode(nodeFromEntrySpecifier(entry).id),
    );
    invariant(entrySpecifierNode.type === 'entry_specifier');
    entrySpecifierNode.correspondingRequest = correspondingRequest;
    let entryFileNodes = resolved.map(file => nodeFromEntryFile(file));
    this.replaceNodesConnectedTo(entrySpecifierNode, entryFileNodes);
  }

  resolveTargets(
    entry: Entry,
    targets: Array<Target>,
    correspondingRequest: string,
  ) {
    let depNodes = targets.map(target =>
      nodeFromDep(
        createDependency({
          moduleSpecifier: entry.filePath,
          pipeline: target.pipeline,
          target: target,
          env: target.env,
          isEntry: true,
        }),
      ),
    );

    let entryNode = nullthrows(this.getNode(nodeFromEntryFile(entry).id));
    invariant(entryNode.type === 'entry_file');
    entryNode.correspondingRequest = correspondingRequest;
    if (this.hasNode(entryNode.id)) {
      this.replaceNodesConnectedTo(entryNode, depNodes);
    }
  }

  resolveDependency(
    dependency: Dependency,
    assetGroup: ?AssetGroup,
    correspondingRequest: string,
  ) {
    let depNode = nullthrows(this.nodes.get(dependency.id));
    invariant(depNode.type === 'dependency');
    if (!depNode) return;
    depNode.correspondingRequest = correspondingRequest;

    if (!assetGroup) {
      return;
    }

    let assetGroupNode = nodeFromAssetGroup(assetGroup);
    let existing = this.getNode(assetGroupNode.id);
    if (existing) {
      invariant(existing.type === 'asset_group');
      assetGroupNode.value.canDefer =
        assetGroupNode.value.canDefer && existing.value.canDefer;
    }

    this.replaceNodesConnectedTo(depNode, [assetGroupNode]);
  }

  shouldVisitChild(node: AssetGraphNode, childNode: AssetGraphNode): boolean {
    if (
      node.type !== 'dependency' ||
      childNode.type !== 'asset_group' ||
      childNode.deferred === false
    ) {
      return true;
    }

    let {sideEffects, canDefer = true} = childNode.value;
    let dependency = node.value;
    let previouslyDeferred = childNode.deferred;
    let defer = this.shouldDeferDependency(dependency, sideEffects, canDefer);
    node.hasDeferred = defer;
    childNode.deferred = defer;

    if (!previouslyDeferred && defer) {
      this.markParentsWithHasDeferred(node);
    } else if (previouslyDeferred && !defer) {
      this.unmarkParentsWithHasDeferred(node);
    }

    return !defer;
  }

  markParentsWithHasDeferred(node: DependencyNode) {
    this.traverseAncestors(node, (_node, _, actions) => {
      if (_node.type === 'asset') {
        _node.hasDeferred = true;
      } else if (_node.type === 'asset_group') {
        _node.hasDeferred = true;
        actions.skipChildren();
      } else if (node !== _node) {
        actions.skipChildren();
      }
    });
  }

  unmarkParentsWithHasDeferred(node: DependencyNode) {
    this.traverseAncestors(node, (_node, ctx, actions) => {
      if (_node.type === 'asset') {
        let hasDeferred = this.getNodesConnectedFrom(_node).some(_childNode =>
          _childNode.hasDeferred == null ? false : _childNode.hasDeferred,
        );
        if (!hasDeferred) {
          delete _node.hasDeferred;
        }
        return {hasDeferred};
      } else if (_node.type === 'asset_group') {
        if (!ctx?.hasDeferred) {
          delete _node.hasDeferred;
        }
        actions.skipChildren();
      } else if (node !== _node) {
        actions.skipChildren();
      }
    });
  }

  // Defer transforming this dependency if it is marked as weak, there are no side effects,
  // no re-exported symbols are used by ancestor dependencies and the re-exporting asset isn't
  // using a wildcard and isn't an entry (in library mode).
  // This helps with performance building large libraries like `lodash-es`, which re-exports
  // a huge number of functions since we can avoid even transforming the files that aren't used.
  shouldDeferDependency(
    dependency: Dependency,
    sideEffects: ?boolean,
    canDefer: boolean,
  ): boolean {
    let defer = false;
    if (
      dependency.isWeak &&
      sideEffects === false &&
      canDefer &&
      !dependency.symbols.has('*')
    ) {
      let depNode = this.getNode(dependency.id);
      invariant(depNode);

      let assets = this.getNodesConnectedTo(depNode);
      let symbols = new Map(
        [...dependency.symbols].map(([key, val]) => [val.local, key]),
      );
      invariant(assets.length === 1);
      let firstAsset = assets[0];
      invariant(firstAsset.type === 'asset');
      let resolvedAsset = firstAsset.value;
      let deps = this.getIncomingDependencies(resolvedAsset);
      defer = deps.every(
        d =>
          !(d.env.isLibrary && d.isEntry) &&
          !d.symbols.has('*') &&
          ![...d.symbols.keys()].some(symbol => {
            let assetSymbol = resolvedAsset.symbols?.get(symbol)?.local;
            return assetSymbol != null && symbols.has(assetSymbol);
          }),
      );
    }
    return defer;
  }

  resolveAssetGroup(
    assetGroup: AssetGroup,
    assets: Array<Asset>,
    correspondingRequest: string,
  ) {
    let assetGroupNode = nodeFromAssetGroup(assetGroup);
    assetGroupNode = this.getNode(assetGroupNode.id);
    if (!assetGroupNode) {
      return;
    }
    invariant(assetGroupNode.type === 'asset_group');
    assetGroupNode.correspondingRequest = correspondingRequest;

    let dependentAssetKeys = [];
    let assetObjects: Array<{|
      assetNode: AssetNode,
      dependentAssets: Array<Asset>,
      isDirect: boolean,
    |}> = [];
    for (let asset of assets) {
      let isDirect = !dependentAssetKeys.includes(asset.uniqueKey);

      let dependentAssets = [];
      for (let dep of asset.dependencies.values()) {
        let dependentAsset = assets.find(
          a => a.uniqueKey === dep.moduleSpecifier,
        );
        if (dependentAsset) {
          dependentAssetKeys.push(dependentAsset.uniqueKey);
          dependentAssets.push(dependentAsset);
        }
      }
      assetObjects.push({
        assetNode: nodeFromAsset(asset),
        dependentAssets,
        isDirect,
      });
    }

    this.replaceNodesConnectedTo(
      assetGroupNode,
      assetObjects.filter(a => a.isDirect).map(a => a.assetNode),
    );
    for (let {assetNode, dependentAssets} of assetObjects) {
      this.resolveAsset(assetNode, dependentAssets);
    }
  }

  resolveAsset(assetNode: AssetNode, dependentAssets: Array<Asset>) {
    let depNodes = [];
    let depNodesWithAssets = [];
    for (let dep of assetNode.value.dependencies.values()) {
      let depNode = nodeFromDep(dep);
      let existing = this.getNode(depNode.id);
      if (existing) {
        invariant(existing.type === 'dependency');
        depNode.value.meta = existing.value.meta;
      }
      let dependentAsset = dependentAssets.find(
        a => a.uniqueKey === dep.moduleSpecifier,
      );
      if (dependentAsset) {
        depNode.complete = true;
        depNodesWithAssets.push([depNode, nodeFromAsset(dependentAsset)]);
      }
      depNodes.push(depNode);
    }
    this.replaceNodesConnectedTo(assetNode, depNodes);

    for (let [depNode, dependentAssetNode] of depNodesWithAssets) {
      this.replaceNodesConnectedTo(depNode, [dependentAssetNode]);
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
      },
    );
  }

  traverseAssets<TContext>(
    visit: GraphVisitor<Asset, TContext>,
    startNode: ?AssetGraphNode,
  ): ?TContext {
    return this.filteredTraverse(
      node => (node.type === 'asset' ? node.value : null),
      visit,
      startNode,
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

  getHash(): string {
    if (this.hash != null) {
      return this.hash;
    }

    let hash = crypto.createHash('md5');
    // TODO: sort??
    this.traverse(node => {
      if (node.type === 'asset') {
        hash.update(nullthrows(node.value.outputHash));
      } else if (node.type === 'dependency' && node.value.target) {
        hash.update(JSON.stringify(node.value.target));
      }
    });

    this.hash = hash.digest('hex');
    return this.hash;
  }
}
