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
  Target,
} from './types';

import invariant from 'assert';
import crypto from 'crypto';
import {DefaultMap, md5FromObject} from '@parcel/utils';
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
  hash: ?string,
|};

function DefaultMapSet() {
  return new Set();
}

export function nodeFromDep(dep: Dependency): DependencyNode {
  return {
    id: dep.id,
    type: 'dependency',
    value: dep,
    deferred: false,
    usedSymbolsDown: new DefaultMap(DefaultMapSet),
    usedSymbolsUp: new Set(),
    usedSymbolsDownDirty: false,
  };
}

export function nodeFromAssetGroup(assetGroup: AssetGroup) {
  return {
    id: md5FromObject(assetGroup),
    type: 'asset_group',
    value: assetGroup,
  };
}

export function nodeFromAsset(asset: Asset): AssetNode {
  return {
    id: asset.id,
    type: 'asset',
    value: asset,
    usedSymbols: new DefaultMap(DefaultMapSet),
  };
}

export function nodeFromEntrySpecifier(entry: string) {
  return {
    id: 'entry_specifier:' + entry,
    type: 'entry_specifier',
    value: entry,
  };
}

export function nodeFromEntryFile(entry: Entry) {
  return {
    id: 'entry_file:' + md5FromObject(entry),
    type: 'entry_file',
    value: entry,
  };
}

export default class AssetGraph extends Graph<AssetGraphNode> {
  onNodeRemoved: ?(node: AssetGraphNode) => mixed;
  hash: ?string;

  // $FlowFixMe
  static deserialize(opts: SerializedAssetGraph): AssetGraph {
    // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
    let res = new AssetGraph(opts);
    // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
    res.hash = opts.hash;
    return res;
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

  addNode(node: AssetGraphNode) {
    this.hash = null;
    return super.addNode(node);
  }

  removeNode(node: AssetGraphNode) {
    this.hash = null;
    this.onNodeRemoved && this.onNodeRemoved(node);

    if (node.type === 'dependency') {
      this.setUsedSymbolsAssetRemoveDependency(node);
    }

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
    let depNodes = targets.map(target => {
      let node = nodeFromDep(
        createDependency({
          moduleSpecifier: entry.filePath,
          pipeline: target.name,
          target: target,
          env: target.env,
          isEntry: true,
        }),
      );
      if (target.env.isLibrary) {
        // in library mode, all of the entry's symbols are "used"
        node.usedSymbolsDown.get('*').add(null);
      }
      return node;
    });

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

    this.replaceNodesConnectedTo(depNode, [nodeFromAssetGroup(assetGroup)]);
  }

  shouldVisitChild(
    parent: ?AssetGraphNode,
    node: AssetGraphNode,
    child: AssetGraphNode,
    wasVisited: boolean,
  ): ?boolean {
    if (
      !wasVisited &&
      node.type === 'dependency' &&
      child.type === 'asset_group'
    ) {
      let dependency = node;
      let sideEffects = child.value.sideEffects;
      let wasDeferred = dependency.deferred;
      let defer = this.shouldDeferDependency(dependency, sideEffects);
      dependency.deferred = defer;
      if (wasDeferred && !defer) {
        return true;
      }
      if (defer) {
        return false;
      }
    }

    if (
      (node.type === 'dependency' && node.usedSymbolsDownDirty) ||
      (child.type === 'dependency' && child.usedSymbolsDownDirty)
    ) {
      return true;
    }

    if (
      parent &&
      parent.type === 'dependency' &&
      parent.usedSymbolsDownDirty &&
      node.type === 'asset_group' &&
      child.type === 'asset'
    ) {
      parent.usedSymbolsDownDirty = false;
      parent.usedSymbolsUp = new Set();
      let outgoingDepsChanged = this.setUsedSymbolsAssetAddDependency(
        [parent],
        child,
        this.getNodesConnectedFrom(child).map(dep => {
          invariant(dep.type === 'dependency');
          return dep;
        }),
      );
      return outgoingDepsChanged || !wasVisited;
    }

    return !wasVisited;
  }

  // Defer transforming this dependency if no re-exported symbols are used by ancestor dependencies.
  // This helps with performance building large libraries like `lodash-es`, which re-exports
  // a huge number of functions since we can avoid even transforming the files that aren't used.
  shouldDeferDependency(
    dependency: DependencyNode,
    sideEffects: ?boolean,
  ): boolean {
    return !!(sideEffects === false && dependency.usedSymbolsDown.size == 0);

    // TODO do we really want this?:
    // one module does `export * from './esm.js'`.
    // then esm.js has `import something from 'commonjs'`, esm.js doesn’t have any used symbols and isn’t included.
    // but commonjs was still getting included.
    // if (sideEffects !== false) return false;
    // if (dependency.usedSymbols.size === 0) return true;
    // let parentAsset =
    //   dependency.value.sourceAssetId != null &&
    //   this.getNode(dependency.value.sourceAssetId);
    // if (parentAsset) {
    //   invariant(parentAsset.type === 'asset');
    //   if (
    //     parentAsset.value.symbols != null &&
    //     parentAsset.value.symbols.size > 0 &&
    //     parentAsset.usedSymbols.size === 0
    //   ) {
    //     return this.getIncomingDependencies(parentAsset.value).every(d => {
    //       let n = this.getNode(d.id);
    //       invariant(n && n.type === 'dependency');
    //       return n.usedSymbols.size === 0;
    //     });
    //   }
    //   return false;
    // }
    // return false;
  }

  setUsedSymbolsAssetAddDependency(
    changedIncomingDeps: $ReadOnlyArray<DependencyNode>,
    assetNode: AssetNode,
    outgoingDeps: $ReadOnlyArray<DependencyNode>,
  ) {
    // exportSymbol -> identifier
    let assetSymbols = assetNode.value.symbols;
    // identifier -> exportSymbol
    let assetSymbolsInverse = assetNode.value.symbols
      ? new Map(
          [...assetNode.value.symbols].map(([key, val]) => [val.local, key]),
        )
      : null;

    let hasNamespaceOutgoingDeps = outgoingDeps.some(
      d => d.value.symbols.get('*')?.local === '*',
    );

    // 1) Determine what the changedIncomingDeps requests from the asset

    let isEntry = false;
    // Used symbols that are exported or reexported (symbol will be removed again later) by asset.
    let assetUsedSymbols: DefaultMap<string, Set<?string>> = new DefaultMap(
      DefaultMapSet,
    );
    // Symbols that have to be namespace reexported by outgoingDeps.
    let namespaceReexportedSymbols: DefaultMap<
      string,
      Set<?string>,
    > = new DefaultMap(DefaultMapSet);

    if (changedIncomingDeps.length === 0) {
      // Root in the runtimes Graph
      assetUsedSymbols.get('*').add(null);
      namespaceReexportedSymbols.get('*').add(null);
    } else {
      for (let incomingDep of changedIncomingDeps) {
        // TODO isIsolated?
        if (incomingDep.value.isEntry || incomingDep.value.isIsolated) {
          isEntry = true;
        }

        for (let [exportSymbol, causes] of incomingDep.usedSymbolsDown) {
          if (causes.size === 0) continue;

          if (exportSymbol === '*') {
            assetUsedSymbols.get('*').add(incomingDep.id);
            namespaceReexportedSymbols.get('*').add(incomingDep.id);
          }
          if (
            !assetSymbols ||
            assetSymbols.has(exportSymbol) ||
            assetSymbols.has('*')
          ) {
            // An own symbol or a non-namespace reexport
            assetUsedSymbols.get(exportSymbol).add(incomingDep.id);
          }
          // A namespace reexport
          // (but only if we actually have namespace-exporting outgoing dependencies,
          // This usually happens with a reexporting asset with many namespace exports which means that
          // we cannot match up the correct asset with the used symbol at this level.)
          else if (hasNamespaceOutgoingDeps) {
            namespaceReexportedSymbols.get(exportSymbol).add(incomingDep.id);
          }
        }
      }
    }

    // console.log(1, {
    //   asset: assetNode.value.filePath,
    //   assetUsedSymbols,
    //   namespaceReexportedSymbols,
    // });

    // 2) Reconcile

    let hasDirtyOutgoingDep = false;
    for (let dep of outgoingDeps) {
      let depUsedSymbolsDownOld = dep.usedSymbolsDown;
      dep.usedSymbolsDown = new DefaultMap(
        DefaultMapSet,
        [...depUsedSymbolsDownOld].map(([k, v]) => [k, new Set(v)]),
      );
      for (let [, cause] of dep.usedSymbolsDown) {
        // old dependencies
        for (let c of cause) {
          if (c != null && !this.hasNode(c)) {
            cause.delete(c);
          }
        }
      }

      if (
        // For entries, we still need to add dep.value.symbols of the entry (which "used" but not by according to symbols data)
        isEntry ||
        // If not a single asset is used, we can say the entire subgraph is not used.
        // This is e.g. needed when some symbol is imported and then used for a export which isn't used (= "semi-weak" reexport)
        //    index.js:     `import {bar} from "./lib"; ...`
        //    lib/index.js: `export * from "./foo.js"; export * from "./bar.js";`
        //    lib/foo.js:   `import { data } from "./bar.js"; export const foo = data + " esm2";`
        // TODO is this really valid?
        assetUsedSymbols.size > 0 ||
        namespaceReexportedSymbols.size > 0
      ) {
        for (let [, cause] of dep.usedSymbolsDown) {
          cause.delete(null);

          // will be set again
          changedIncomingDeps.forEach(incomingDep =>
            cause.delete(incomingDep.id),
          );
        }

        if (dep.value.symbols.get('*')?.local === '*') {
          for (let [s, cause] of namespaceReexportedSymbols) {
            // We need to propagate the namespaceReexportedSymbols to all namespace dependencies (= even wrong ones because we don't know yet)
            let set = dep.usedSymbolsDown.get(s);
            cause.forEach(incomingDep => set.add(incomingDep));
          }
        }

        for (let [symbol, {local}] of dep.value.symbols) {
          // Was already handled above
          if (local === '*') continue;

          if (!assetSymbolsInverse || !dep.value.symbols.get(symbol)?.isWeak) {
            // Bailout or non-weak symbol (= used in the asset itself = not a reexport)
            dep.usedSymbolsDown.get(symbol).add(null);
          } else {
            let reexportedExportSymbol = assetSymbolsInverse.get(local);
            if (
              reexportedExportSymbol == null // not reexported = used in asset itself
            ) {
              dep.usedSymbolsDown.get(symbol).add(null);
            } else if (
              assetUsedSymbols.get('*').size > 0 || // we need everything
              assetUsedSymbols.get(reexportedExportSymbol).size > 0 // reexported
            ) {
              // The symbol is indeed a reexport, so it's not used from the asset itself
              let causes = dep.usedSymbolsDown.get(symbol);
              [
                ...assetUsedSymbols.get(reexportedExportSymbol),
                ...assetUsedSymbols.get('*'),
              ].forEach(cause => causes.add(cause));

              assetUsedSymbols.delete(reexportedExportSymbol);
            }
          }
        }

        dep.usedSymbolsDownDirty = !equalSet(
          new Set(
            [...depUsedSymbolsDownOld]
              .filter(([, v]) => v.size > 0)
              .map(([v]) => v),
          ),
          new Set(
            [...dep.usedSymbolsDown]
              .filter(([, v]) => v.size > 0)
              .map(([v]) => v),
          ),
        );

        if (dep.usedSymbolsDownDirty) {
          hasDirtyOutgoingDep = true;
        }

        // console.log(2, {
        //   from: assetNode.value.filePath,
        //   to: dep.value.moduleSpecifier,
        //   dirty: dep.usedSymbolsDownDirty,
        //   old: [...depUsedSymbolsDownOld]
        //     .filter(([, v]) => v.size > 0)
        //     .map(([k, v]) => [k, ...v]),
        //   new: [...dep.usedSymbolsDown]
        //     .filter(([, v]) => v.size > 0)
        //     .map(([k, v]) => [k, ...v]),
        // });
      }
    }

    for (let [, cause] of assetNode.usedSymbols) {
      changedIncomingDeps.forEach(incomingDep => cause.delete(incomingDep.id));
    }
    for (let [symbol, cause] of assetUsedSymbols) {
      let set = assetNode.usedSymbols.get(symbol);
      cause.forEach(incomingDep => set.add(incomingDep));
    }

    // console.log(
    //   3,
    //   assetNode.value.filePath,
    //   hasDirtyOutgoingDep,
    //   changedIncomingDeps.map(d => [
    //     d.value.sourcePath + ':' + d.value.moduleSpecifier,
    //     d.id,
    //     ...d.usedSymbolsDown.keys(),
    //   ]),
    // );
    return hasDirtyOutgoingDep;
  }

  setUsedSymbolsAssetRemoveDependency(removedIncomingDep: DependencyNode) {
    if (removedIncomingDep.deferred) return;

    let assetGroups = this.getNodesConnectedFrom(removedIncomingDep);
    invariant(assetGroups.length === 1);
    let [assetGroup] = assetGroups;
    invariant(assetGroup.type === 'asset_group');
    let assets = this.getNodesConnectedFrom(assetGroup);
    invariant(assets.length === 1);
    let [asset] = assets;
    invariant(asset.type === 'asset');

    for (let dep of this.getNodesConnectedFrom(asset)) {
      invariant(dep.type === 'dependency');
      let changed = false;
      for (let [, cause] of dep.usedSymbolsDown) {
        if (cause.has(removedIncomingDep.id)) {
          changed = true;
          cause.delete(removedIncomingDep.id);
        }
      }
      if (changed) {
        dep.usedSymbolsDownDirty = true;
      }
    }
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

      // TODO ???
      let assetNode = this.getNode(asset.id) ?? nodeFromAsset(asset);
      invariant(assetNode.type === 'asset');
      assetNode.value = asset;
      assetObjects.push({
        assetNode,
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
    let depNodes: Array<DependencyNode> = [];
    let depNodesWithAssets = [];
    for (let dep of assetNode.value.dependencies.values()) {
      // TODO ???
      let depNode = this.getNode(dep.id) ?? nodeFromDep(dep);
      invariant(depNode.type === 'dependency');
      depNode.value = dep;

      let dependentAsset = dependentAssets.find(
        a => a.uniqueKey === dep.moduleSpecifier,
      );
      if (dependentAsset) {
        depNode.complete = true;
        depNodesWithAssets.push([depNode, nodeFromAsset(dependentAsset)]);
      }
      depNodes.push(depNode);
    }
    let oldDepNodes = this.getNodesConnectedFrom(assetNode);
    for (let d of oldDepNodes) {
      invariant(d.type === 'dependency');
      if (!depNodes.find(d2 => d.id === d2.id)) {
        // will be removed
        this.setUsedSymbolsAssetRemoveDependency(d);
      }
    }

    this.replaceNodesConnectedTo(assetNode, depNodes);

    this.setUsedSymbolsAssetAddDependency(
      this.getIncomingDependencies(assetNode.value).map(d => {
        let n = this.getNode(d.id);
        invariant(n && n.type === 'dependency');
        n.usedSymbolsDownDirty = false;
        return n;
      }),
      assetNode,
      depNodes,
    );

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

  getHash() {
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

function equalSet<T>(a: $ReadOnlySet<T>, b: $ReadOnlySet<T>) {
  return a.size === b.size && [...a].every(i => b.has(i));
}
