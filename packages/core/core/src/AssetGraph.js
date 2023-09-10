// @flow strict-local

import type {GraphVisitor} from '@parcel/types';
import type {
  ContentGraphOpts,
  ContentKey,
  NodeId,
  SerializedContentGraph,
} from '@parcel/graph';
import type {
  Asset,
  AssetGraphNode,
  AssetGroup,
  AssetGroupNode,
  AssetNode,
  CommittedAssetId,
  Dependency,
  DependencyNode,
  Entry,
  EntryFileNode,
  EntrySpecifierNode,
  Environment,
  Target,
} from './types';

import invariant from 'assert';
import {hashString, Hash} from '@parcel/rust';
import {hashObject} from '@parcel/utils';
import nullthrows from 'nullthrows';
import {ContentGraph} from '@parcel/graph';
import {createDependency} from './Dependency';
import {type ProjectPath, fromProjectPathRelative} from './projectPath';
import {
  type SerializedParcelDb,
  Environment as DbEnvironment,
  EnvironmentFlags,
  Dependency as DbDependency,
  Target as DbTarget,
  DependencyFlags,
  Asset as DbAsset,
  SymbolFlags,
  ParcelDb,
} from '@parcel/rust';

type InitOpts = {|
  entries?: Array<ProjectPath>,
  targets?: Array<Target>,
  assetGroups?: Array<AssetGroup>,
|};

type AssetGraphOpts = {|
  ...ContentGraphOpts<AssetGraphNode>,
  hash?: ?string,
|};

type SerializedAssetGraph = {|
  ...SerializedContentGraph<AssetGraphNode>,
  hash?: ?string,
  db: SerializedParcelDb
|};

export function nodeFromDep(dep: Dependency): DependencyNode {
  return {
    id: dep,
    type: 'dependency',
    value: dep,
    deferred: false,
    excluded: false,
    usedSymbolsDown: new Set(),
    usedSymbolsUp: new Map(),
    usedSymbolsDownDirty: true,
    usedSymbolsUpDirtyDown: true,
    usedSymbolsUpDirtyUp: true,
  };
}

export function nodeFromAssetGroup(assetGroup: AssetGroup): AssetGroupNode {
  return {
    id: hashString(
      fromProjectPathRelative(assetGroup.filePath) +
        String(assetGroup.env) +
        String(assetGroup.isSource) +
        String(assetGroup.sideEffects) +
        (assetGroup.code ?? '') +
        ':' +
        (assetGroup.pipeline ?? '') +
        ':' +
        (assetGroup.query ?? ''),
    ),
    type: 'asset_group',
    value: assetGroup,
    usedSymbolsDownDirty: true,
  };
}

export function nodeFromAsset(asset: CommittedAssetId): AssetNode {
  return {
    id: asset,
    type: 'asset',
    value: asset,
    usedSymbols: new Set(),
    usedSymbolsDownDirty: true,
    usedSymbolsUpDirty: true,
  };
}

export function nodeFromEntrySpecifier(entry: ProjectPath): EntrySpecifierNode {
  return {
    id: 'entry_specifier:' + fromProjectPathRelative(entry),
    type: 'entry_specifier',
    value: entry,
  };
}

export function nodeFromEntryFile(entry: Entry): EntryFileNode {
  return {
    id: 'entry_file:' + hashObject(entry),
    type: 'entry_file',
    value: entry,
  };
}

export default class AssetGraph extends ContentGraph<AssetGraphNode> {
  onNodeRemoved: ?(nodeId: NodeId) => mixed;
  hash: ?string;
  envCache: Map<string, Environment>;
  safeToIncrementallyBundle: boolean = true;
  db: ParcelDb;

  constructor(db: ParcelDb, opts: ?AssetGraphOpts) {
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
    this.db = db;
  }

  // $FlowFixMe[prop-missing]
  static deserialize(opts: SerializedAssetGraph): AssetGraph {
    // $FlowFixMe
    return new AssetGraph(ParcelDb.deserialize(opts.db), opts);
  }

  // $FlowFixMe[prop-missing]
  serialize(): SerializedAssetGraph {
    return {
      ...super.serialize(),
      hash: this.hash,
      db: this.db.serialize()
    };
  }

  // Deduplicates Environments by making them referentially equal
  normalizeEnvironment(input: Asset | Dependency | AssetGroup) {
    // let {id, context} = input.env;
    // let idAndContext = `${id}-${context}`;
    // let env = this.envCache.get(idAndContext);
    // if (env) {
    //   input.env = env;
    // } else {
    //   this.envCache.set(idAndContext, input.env);
    // }
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
    let existing = this.getNodeByContentKey(node.id);
    if (existing != null) {
      invariant(existing.type === node.type);
      // $FlowFixMe[incompatible-type] Checked above
      // $FlowFixMe[prop-missing]
      existing.value = node.value;
      let existingId = this.getNodeIdByContentKey(node.id);
      this.updateNode(existingId, existing);
      return existingId;
    }
    return super.addNodeByContentKey(node.id, node);
  }

  removeNode(nodeId: NodeId): void {
    this.hash = null;
    this.onNodeRemoved && this.onNodeRemoved(nodeId);
    return super.removeNode(nodeId);
  }

  resolveEntry(
    entry: ProjectPath,
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
    let depNodes = targets.map(targetId => {
      let target = DbTarget.get(this.db, targetId);
      let node = nodeFromDep(
        // The passed project path is ignored in this case, because there is no `loc`
        createDependency(this.db, '', {
          specifier: fromProjectPathRelative(entry.filePath),
          specifierType: 'esm', // ???
          pipeline: target.pipeline,
          target: targetId,
          env: target.env,
          isEntry: true,
          needsStableName: true,
          symbols:
            DbEnvironment.get(this.db, target.env).flags & EnvironmentFlags.IS_LIBRARY
              ? new Map([['*', {local: '*', isWeak: true, loc: null}]])
              : undefined,
        }),
      );

      if (DbEnvironment.get(this.db, target.env).flags & EnvironmentFlags.IS_LIBRARY) {
        // in library mode, all of the entry's symbols are "used"
        node.usedSymbolsDown.add(this.db.starSymbol);
        node.usedSymbolsUp.set(this.db.starSymbol, undefined);
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
    let depNodeId = this.getNodeIdByContentKey(dependency);
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
    this.replaceNodeIdsConnectedTo(this.getNodeIdByContentKey(dependency), [
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
    // Node types are proved above
    let dependencyNode = node;
    let assetGroupNode = childNode;

    let {sideEffects, canDefer = true} = assetGroupNode.value;
    let dependency = dependencyNode.value;
    let dependencyPreviouslyDeferred = dependencyNode.hasDeferred;
    let assetGroupPreviouslyDeferred = assetGroupNode.deferred;
    let defer = this.shouldDeferDependency(dependency, sideEffects, canDefer);
    dependencyNode.hasDeferred = defer;
    assetGroupNode.deferred = defer;

    if (!dependencyPreviouslyDeferred && defer) {
      this.markParentsWithHasDeferred(nodeId);
    } else if (assetGroupPreviouslyDeferred && !defer) {
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
    dependencyId: Dependency,
    sideEffects: ?boolean,
    canDefer: boolean,
  ): boolean {
    let defer = false;
    let dependency = DbDependency.get(this.db, dependencyId);
    let dependencySymbols = dependency.symbols;
    if (
      dependencySymbols &&
      dependencySymbols.every(({flags}) => flags & SymbolFlags.IS_WEAK) &&
      sideEffects === false &&
      canDefer &&
      !dependencySymbols.some(s => s.exported === this.db.starSymbol)
    ) {
      let depNodeId = this.getNodeIdByContentKey(dependencyId);
      let depNode = this.getNode(depNodeId);
      invariant(depNode);

      let assets = this.getNodeIdsConnectedTo(depNodeId);
      let symbols = new Map(
        [...dependencySymbols].map(s => [s.local, s.exported]),
      );
      invariant(assets.length === 1);
      let firstAsset = nullthrows(this.getNode(assets[0]));
      invariant(firstAsset.type === 'asset');
      let resolvedAsset = DbAsset.get(this.db, firstAsset.value);
      let deps = this.getIncomingDependencies(firstAsset.value).map(d =>
        DbDependency.get(this.db, d),
      );
      defer = deps.every(
        d =>
          d.symbols &&
          !(
            DbEnvironment.get(this.db, d.env).flags & EnvironmentFlags.IS_LIBRARY &&
            d.flags & DependencyFlags.ENTRY
          ) &&
          !d.symbols.some(s => s.exported === this.db.starSymbol) &&
          !d.symbols.some(s => {
            if (!resolvedAsset.symbols) return true;
            let assetSymbol = resolvedAsset.symbols?.find(
              sym => sym.exported === s.exported,
            )?.local;
            return assetSymbol != null && symbols.has(assetSymbol);
          }),
      );
    }
    return defer;
  }

  resolveAssetGroup(
    assetGroup: AssetGroup,
    assets: Array<{|
      asset: CommittedAssetId,
      dependencies: Array<Dependency>,
    |}>,
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

    let assetsByKey = new Map();
    for (let {asset: assetId} of assets) {
      let asset = DbAsset.get(this.db, assetId);
      if (asset.uniqueKey != null) {
        assetsByKey.set(asset.uniqueKey, assetId);
      }
    }

    let dependentAssetKeys = new Set();
    for (let asset of assets) {
      for (let d of asset.dependencies) {
        let dep = DbDependency.get(this.db, d);
        if (assetsByKey.has(dep.specifier)) {
          dependentAssetKeys.add(dep.specifier);
        }
      }
    }

    let assetObjects: Array<{|
      assetNodeId: NodeId,
      dependencies: Array<Dependency>,
      dependentAssets: Array<CommittedAssetId>,
    |}> = [];
    let assetNodeIds = [];
    for (let {asset: assetId, dependencies} of assets) {
      // this.normalizeEnvironment(asset);
      let asset = DbAsset.get(this.db, assetId);
      let isDirect = !dependentAssetKeys.has(asset.uniqueKey);

      let dependentAssets = [];
      for (let d of dependencies.values()) {
        let dep = DbDependency.get(this.db, d);
        let dependentAsset = assetsByKey.get(dep.specifier);
        if (dependentAsset != null) {
          dependentAssets.push(dependentAsset);
          if (dependentAsset === assetId) {
            // Don't orphan circular dependencies.
            isDirect = true;
          }
        }
      }
      let id = this.addNode(nodeFromAsset(assetId));
      assetObjects.push({
        assetNodeId: id,
        dependencies,
        dependentAssets,
      });

      if (isDirect) {
        assetNodeIds.push(id);
      }
    }

    this.replaceNodeIdsConnectedTo(
      this.getNodeIdByContentKey(assetGroupNode.id),
      assetNodeIds,
    );
    for (let {assetNodeId, dependencies, dependentAssets} of assetObjects) {
      // replaceNodesConnectedTo has merged the value into the existing node, retrieve
      // the actual current node.
      let assetNode = nullthrows(this.getNode(assetNodeId));
      invariant(assetNode.type === 'asset');
      this.resolveAsset(assetNode, dependencies, dependentAssets);
    }
  }

  resolveAsset(
    assetNode: AssetNode,
    dependencies: Array<Dependency>,
    dependentAssets: Array<CommittedAssetId>,
  ) {
    let depNodeIds: Array<NodeId> = [];
    let depNodesWithAssets = [];
    for (let d of dependencies) {
      let dep = DbDependency.get(this.db, d);
      // this.normalizeEnvironment(dep);
      let depNode = nodeFromDep(d);
      // let existing = this.getNodeByContentKey(depNode.id);
      // if (
      //   existing?.type === 'dependency' &&
      //   existing.value.resolverMeta != null
      // ) {
      //   depNode.value.meta = {
      //     ...depNode.value.meta,
      //     ...existing.value.resolverMeta,
      //   };
      // }
      let dependentAsset = dependentAssets.find(
        a => DbAsset.get(this.db, a).uniqueKey === dep.specifier,
      );
      if (dependentAsset != null) {
        depNode.complete = true;
        depNodesWithAssets.push([depNode, nodeFromAsset(dependentAsset)]);
      }
      depNodeIds.push(this.addNode(depNode));
    }

    assetNode.usedSymbolsUpDirty = true;
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

  getIncomingDependencies(asset: CommittedAssetId): Array<Dependency> {
    let nodeId = this.getNodeIdByContentKey(asset);
    let assetGroupIds = this.getNodeIdsConnectedTo(nodeId);
    let dependencies = [];
    for (let i = 0; i < assetGroupIds.length; i++) {
      let assetGroupId = assetGroupIds[i];

      // Sometimes assets are connected directly to dependencies
      // rather than through an asset group. This happens due to
      // inline dependencies on assets via uniqueKey. See resolveAsset.
      let node = this.getNode(assetGroupId);
      if (node?.type === 'dependency') {
        dependencies.push(node.value);
        continue;
      }

      let assetIds = this.getNodeIdsConnectedTo(assetGroupId);
      for (let j = 0; j < assetIds.length; j++) {
        let node = this.getNode(assetIds[j]);
        if (!node || node.type !== 'dependency') {
          continue;
        }

        dependencies.push(node.value);
      }
    }

    return dependencies;
  }

  traverseAssets<TContext>(
    visit: GraphVisitor<CommittedAssetId, TContext>,
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

  getEntryAssets(): Array<CommittedAssetId> {
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

    let hash = new Hash();
    // TODO: sort??
    this.traverse(nodeId => {
      let node = nullthrows(this.getNode(nodeId));
      if (node.type === 'asset') {
        hash.writeString(nullthrows(DbAsset.get(this.db, node.value).outputHash));
      } else if (node.type === 'dependency') {
        let target = DbDependency.get(this.db, node.value).target;
        if (target) {
          hash.writeString(JSON.stringify(target));
        }
      }
    });

    this.hash = hash.finish();
    return this.hash;
  }
}
