// @flow strict-local

import type {GraphVisitor} from '@parcel/types';
import type {
  Asset,
  AssetGraphNode,
  AssetGroup,
  AssetGroupNode,
  AssetNode,
  ContentKey,
  Dependency,
  DependencyNode,
  Entry,
  EntryFileNode,
  EntrySpecifierNode,
  Environment,
  NodeId,
  Target,
} from './types';

import invariant from 'assert';
import crypto from 'crypto';
import {
  md5FromObject,
  md5FromOrderedObject,
  objectSortedEntries,
} from '@parcel/utils';
import nullthrows from 'nullthrows';
import ContentGraph, {type SerializedContentGraph} from './ContentGraph';
import {createDependency} from './Dependency';

type InitOpts = {|
  entries?: Array<string>,
  targets?: Array<Target>,
  assetGroups?: Array<AssetGroup>,
|};

type SerializedAssetGraph = {|
  ...SerializedContentGraph<AssetGraphNode>,
  hash?: ?string,
|};

export function nodeFromDep(dep: Dependency): DependencyNode {
  return {
    id: dep.id,
    type: 'dependency',
    value: dep,
    deferred: false,
    excluded: false,
    usedSymbolsDown: new Set(),
    usedSymbolsUp: new Set(),
    usedSymbolsDownDirty: true,
    usedSymbolsUpDirtyDown: true,
    usedSymbolsUpDirtyUp: true,
  };
}

export function nodeFromAssetGroup(assetGroup: AssetGroup): AssetGroupNode {
  return {
    id: md5FromOrderedObject({
      filePath: assetGroup.filePath,
      env: assetGroup.env.id,
      isSource: assetGroup.isSource,
      sideEffects: assetGroup.sideEffects,
      code: assetGroup.code,
      pipeline: assetGroup.pipeline,
      query: assetGroup.query ? objectSortedEntries(assetGroup.query) : null,
    }),
    type: 'asset_group',
    value: assetGroup,
    usedSymbolsDownDirty: true,
  };
}

export function nodeFromAsset(asset: Asset): AssetNode {
  return {
    id: asset.id,
    type: 'asset',
    value: asset,
    usedSymbols: new Set(),
    usedSymbolsDownDirty: true,
    usedSymbolsUpDirty: true,
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

export default class AssetGraph extends ContentGraph<AssetGraphNode> {
  onNodeRemoved: ?(nodeId: NodeId) => mixed;
  hash: ?string;
  envCache: Map<string, Environment>;

  constructor(opts: ?SerializedAssetGraph) {
    if (opts) {
      let {hash, ...rest} = opts;
      super(rest);
      this.hash = hash;
    } else {
      super();
      this.setRootNodeId(
        this.addNode({
          id: '@@root',
          type: 'root',
          value: null,
        }),
      );
    }
    this.envCache = new Map();
  }

  // $FlowFixMe[prop-missing]
  static deserialize(opts: SerializedAssetGraph): AssetGraph {
    return new AssetGraph(opts);
  }

  // $FlowFixMe[prop-missing]
  serialize(): SerializedAssetGraph {
    return {
      ...super.serialize(),
      hash: this.hash,
    };
  }

  // Deduplicates Environments by making them referentially equal
  normalizeEnvironment(input: Asset | Dependency | AssetGroup) {
    let {id, context} = input.env;
    let idAndContext = `${id}-${context}`;

    let env = this.envCache.get(idAndContext);
    if (env) {
      input.env = env;
    } else {
      this.envCache.set(idAndContext, input.env);
    }
  }

  setRootConnections({entries, assetGroups}: InitOpts) {
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
    this.replaceNodeIdsConnectedTo(
      nullthrows(this.rootNodeId),
      nodes.map(node => this.addNode(node)),
    );
  }

  addNode(node: AssetGraphNode): NodeId {
    this.hash = null;
    return super.addNodeByContentKey(node.id, node);
  }

  removeNode(nodeId: NodeId): void {
    this.hash = null;
    this.onNodeRemoved && this.onNodeRemoved(nodeId);
    // This needs to mark all connected nodes that doesn't become orphaned
    // due to replaceNodesConnectedTo to make sure that the symbols of
    // nodes from which at least one parent was removed are updated.
    let node = nullthrows(this.getNode(nodeId));
    if (this.isOrphanedNode(nodeId) && node.type === 'dependency') {
      let children = this.getNodeIdsConnectedFrom(nodeId).map(id =>
        nullthrows(this.getNode(id)),
      );
      for (let n of children) {
        invariant(n.type === 'asset_group' || n.type === 'asset');
        n.usedSymbolsDownDirty = true;
      }
    }
    return super.removeNode(nodeId);
  }

  resolveEntry(
    entry: string,
    resolved: Array<Entry>,
    correspondingRequest: ContentKey,
  ) {
    let entrySpecifierNodeId = this.getNodeIdByContentKey(
      nodeFromEntrySpecifier(entry).id,
    );
    let entrySpecifierNode = nullthrows(this.getNode(entrySpecifierNodeId));
    invariant(entrySpecifierNode.type === 'entry_specifier');
    entrySpecifierNode.correspondingRequest = correspondingRequest;

    this.replaceNodeIdsConnectedTo(
      entrySpecifierNodeId,
      resolved.map(file => this.addNode(nodeFromEntryFile(file))),
    );
  }

  resolveTargets(
    entry: Entry,
    targets: Array<Target>,
    correspondingRequest: string,
  ) {
    let depNodes = targets.map(target => {
      let node = nodeFromDep(
        createDependency({
          moduleSpecifier: entry.filePath,
          pipeline: target.pipeline,
          target: target,
          env: target.env,
          isEntry: true,
          symbols: target.env.isLibrary
            ? new Map([['*', {local: '*', isWeak: true, loc: null}]])
            : undefined,
        }),
      );

      if (node.value.env.isLibrary) {
        // in library mode, all of the entry's symbols are "used"
        node.usedSymbolsDown.add('*');
      }
      return node;
    });

    let entryNodeId = this.getNodeIdByContentKey(nodeFromEntryFile(entry).id);
    let entryNode = nullthrows(this.getNode(entryNodeId));
    invariant(entryNode.type === 'entry_file');
    entryNode.correspondingRequest = correspondingRequest;

    this.replaceNodeIdsConnectedTo(
      entryNodeId,
      depNodes.map(node => this.addNode(node)),
    );
  }

  resolveDependency(
    dependency: Dependency,
    assetGroup: ?AssetGroup,
    correspondingRequest: string,
  ) {
    let depNodeId = this.getNodeIdByContentKey(dependency.id);
    let depNode = nullthrows(this.getNode(depNodeId));
    invariant(depNode.type === 'dependency');
    depNode.correspondingRequest = correspondingRequest;

    if (!assetGroup) {
      return;
    }

    let assetGroupNode = nodeFromAssetGroup(assetGroup);
    let existing = this.getNodeByContentKey(assetGroupNode.id);
    if (existing != null) {
      invariant(existing.type === 'asset_group');
      assetGroupNode.value.canDefer =
        assetGroupNode.value.canDefer && existing.value.canDefer;
    }

    let assetGroupNodeId = this.addNode(assetGroupNode);
    this.replaceNodeIdsConnectedTo(this.getNodeIdByContentKey(dependency.id), [
      assetGroupNodeId,
    ]);

    this.replaceNodeIdsConnectedTo(depNodeId, [assetGroupNodeId]);
  }

  shouldVisitChild(nodeId: NodeId, childNodeId: NodeId): boolean {
    let node = nullthrows(this.getNode(nodeId));
    let childNode = nullthrows(this.getNode(childNodeId));
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
      this.markParentsWithHasDeferred(nodeId);
    } else if (previouslyDeferred && !defer) {
      this.unmarkParentsWithHasDeferred(childNodeId);
    }

    return !defer;
  }

  // Dependency: mark parent Asset <- AssetGroup with hasDeferred true
  markParentsWithHasDeferred(nodeId: NodeId) {
    this.traverseAncestors(nodeId, (traversedNodeId, _, actions) => {
      let traversedNode = nullthrows(this.getNode(traversedNodeId));
      if (traversedNode.type === 'asset') {
        traversedNode.hasDeferred = true;
      } else if (traversedNode.type === 'asset_group') {
        traversedNode.hasDeferred = true;
        actions.skipChildren();
      } else if (nodeId !== traversedNodeId) {
        actions.skipChildren();
      }
    });
  }

  // AssetGroup: update hasDeferred of all parent Dependency <- Asset <- AssetGroup
  unmarkParentsWithHasDeferred(nodeId: NodeId) {
    this.traverseAncestors(nodeId, (traversedNodeId, ctx, actions) => {
      let traversedNode = nullthrows(this.getNode(traversedNodeId));
      if (traversedNode.type === 'asset') {
        let hasDeferred = this.getNodeIdsConnectedFrom(traversedNodeId).some(
          childNodeId => {
            let childNode = nullthrows(this.getNode(childNodeId));
            return childNode.hasDeferred == null
              ? false
              : childNode.hasDeferred;
          },
        );
        if (!hasDeferred) {
          delete traversedNode.hasDeferred;
        }
        return {hasDeferred};
      } else if (
        traversedNode.type === 'asset_group' &&
        nodeId !== traversedNodeId
      ) {
        if (!ctx?.hasDeferred) {
          delete traversedNode.hasDeferred;
        }
        actions.skipChildren();
      } else if (traversedNode.type === 'dependency') {
        traversedNode.hasDeferred = false;
      } else if (nodeId !== traversedNodeId) {
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
    let dependencySymbols = dependency.symbols;
    if (
      dependencySymbols &&
      [...dependencySymbols].every(([, {isWeak}]) => isWeak) &&
      sideEffects === false &&
      canDefer &&
      !dependencySymbols.has('*')
    ) {
      let depNodeId = this.getNodeIdByContentKey(dependency.id);
      let depNode = this.getNode(depNodeId);
      invariant(depNode);

      let assets = this.getNodeIdsConnectedTo(depNodeId);
      let symbols = new Map(
        [...dependencySymbols].map(([key, val]) => [val.local, key]),
      );
      invariant(assets.length === 1);
      let firstAsset = nullthrows(this.getNode(assets[0]));
      invariant(firstAsset.type === 'asset');
      let resolvedAsset = firstAsset.value;
      let deps = this.getIncomingDependencies(resolvedAsset);
      defer = deps.every(
        d =>
          d.symbols &&
          !(d.env.isLibrary && d.isEntry) &&
          !d.symbols.has('*') &&
          ![...d.symbols.keys()].some(symbol => {
            if (!resolvedAsset.symbols) return true;
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
    correspondingRequest: ContentKey,
  ) {
    this.normalizeEnvironment(assetGroup);
    let assetGroupNode = nodeFromAssetGroup(assetGroup);
    assetGroupNode = this.getNodeByContentKey(assetGroupNode.id);
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
      this.normalizeEnvironment(asset);
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

    const assetNodeIds = [];
    for (let {assetNode, isDirect} of assetObjects) {
      if (isDirect) {
        assetNodeIds.push(this.addNode(assetNode));
      }
    }

    this.replaceNodeIdsConnectedTo(
      this.getNodeIdByContentKey(assetGroupNode.id),
      assetNodeIds,
    );
    for (let {assetNode, dependentAssets} of assetObjects) {
      // replaceNodesConnectedTo has merged the value into the existing node, retrieve
      // the actual current node.
      assetNode = nullthrows(this.getNodeByContentKey(assetNode.id));
      invariant(assetNode.type === 'asset');
      this.resolveAsset(assetNode, dependentAssets);
    }
  }

  resolveAsset(assetNode: AssetNode, dependentAssets: Array<Asset>) {
    let depNodeIds: Array<NodeId> = [];
    let depNodesWithAssets = [];
    for (let dep of assetNode.value.dependencies.values()) {
      this.normalizeEnvironment(dep);
      let depNode = nodeFromDep(dep);
      let existing = this.getNodeByContentKey(depNode.id);
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
      depNodeIds.push(this.addNode(depNode));
    }

    assetNode.usedSymbolsDownDirty = true;
    this.replaceNodeIdsConnectedTo(
      this.getNodeIdByContentKey(assetNode.id),
      depNodeIds,
    );

    for (let [depNode, dependentAssetNode] of depNodesWithAssets) {
      let depAssetNodeId = this.addNode(dependentAssetNode);

      this.replaceNodeIdsConnectedTo(this.getNodeIdByContentKey(depNode.id), [
        depAssetNodeId,
      ]);
    }
  }

  getIncomingDependencies(asset: Asset): Array<Dependency> {
    if (!this.hasContentKey(asset.id)) {
      return [];
    }

    let nodeId = this.getNodeIdByContentKey(asset.id);
    return this.findAncestors(nodeId, nodeId => {
      let node = this.getNode(nodeId);
      return node?.type === 'dependency';
    }).map(nodeId => {
      let node = this.getNode(nodeId);
      invariant(node?.type === 'dependency');
      return node.value;
    });
  }

  traverseAssets<TContext>(
    visit: GraphVisitor<Asset, TContext>,
    startNodeId: ?NodeId,
  ): ?TContext {
    return this.filteredTraverse(
      nodeId => {
        let node = nullthrows(this.getNode(nodeId));
        return node.type === 'asset' ? node.value : null;
      },
      visit,
      startNodeId,
    );
  }

  getEntryAssetGroupNodes(): Array<AssetGroupNode> {
    let entryNodes = [];
    this.traverse((nodeId, _, actions) => {
      let node = nullthrows(this.getNode(nodeId));
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
    this.traverse(nodeId => {
      let node = nullthrows(this.getNode(nodeId));
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
