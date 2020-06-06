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
  hash: ?string,
|};

export function nodeFromDep(dep: Dependency): DependencyNode {
  return {
    id: dep.id,
    type: 'dependency',
    value: dep,
    deferred: false,
    usedSymbols: new Set(),
    usedSymbolsDirty: false,
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
    usedSymbols: new Set(),
    usedSymbolsDirty: false,
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
        node.usedSymbols.add('*');
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
    if (child.type === 'dependency' && child.usedSymbolsDirty) return true;

    if (node.type === 'dependency' && child.type === 'asset_group') {
      let dependency = node;
      let sideEffects = child.value.sideEffects;
      let defer = this.shouldDeferDependency(dependency, sideEffects);
      dependency.deferred = defer;
      return !defer;
    }

    if (
      parent &&
      parent.type === 'dependency' &&
      parent.usedSymbolsDirty &&
      node.type === 'asset_group' &&
      child.type === 'asset'
    ) {
      parent.usedSymbolsDirty = false;
      let outgoingDepsChanged = this.setUsedSymbolsAsset(
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
    return !!(sideEffects === false && dependency.usedSymbols.size == 0);

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

  setUsedSymbolsAsset(
    assetNode: AssetNode,
    outgoingDeps: $ReadOnlyArray<DependencyNode>,
  ) {
    let hasDirtyOutgoingDep = false;
    function outgoingDepAddSymbol(dep, symbol) {
      if (!dep.usedSymbols.has(symbol)) {
        dep.usedSymbols.add(symbol);
        dep.usedSymbolsDirty = true;
        hasDirtyOutgoingDep = true;
      }
    }

    let incomingDeps = this.getIncomingDependencies(assetNode.value).map(d => {
      let n = this.getNode(d.id);
      invariant(n && n.type === 'dependency');
      n.usedSymbolsDirty = false;
      return n;
    });

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

    let isEntry = false;
    // Used symbols that are either exported by asset or reexported (symbol will be removed again lated).
    let assetUsedSymbols = new Set<string>();
    // Symbols that have to be namespace reexported by asset.
    let namespaceReexportedSymbols = new Set<string>();
    for (let incomingDep of incomingDeps) {
      if (incomingDep.value.isEntry || incomingDep.value.isAsync)
        isEntry = true;

      for (let exportSymbol of incomingDep.usedSymbols) {
        if (exportSymbol === '*') {
          // There is no point in continuing with the loop here, everything is used anyway.
          assetUsedSymbols = new Set(['*']);
          namespaceReexportedSymbols = new Set(['*']);
          break;
        }
        if (
          !assetSymbols ||
          assetSymbols.has(exportSymbol) ||
          assetSymbols.has('*')
        ) {
          // An own symbol or a non-namespace reexport
          assetUsedSymbols.add(exportSymbol);
        }
        // A namespace reexport
        // (but only if we actually have namespace-exporting outgoing dependencies,
        // This usually happens with a reexporting asset with many namespace exports which means that
        // we cannot match up the correct asset with the used symbol at this level.)
        else if (hasNamespaceOutgoingDeps) {
          namespaceReexportedSymbols.add(exportSymbol);
        }
      }
    }

    if (incomingDeps.length === 0) {
      // Root in the runtimes Graph
      assetUsedSymbols = new Set(['*']);
      namespaceReexportedSymbols = new Set(['*']);
    }

    if (
      // For entries, we still need to add dep.value.symbols of the entry (which "used" but not by according to symbols data)
      isEntry ||
      // If not a single asset is used, we can say the entires subgraph is not used.
      // This is e.g. needed when some symbol is imported and then used for a export which isn't used (= "semi-weak" reexport)
      //    index.js:     `import {bar} from "./lib"; ...`
      //    lib/index.js: `export * from "./foo.js"; export * from "./bar.js";`
      //    lib/foo.js:   `import { data } from "./bar.js"; export const foo = data + " esm2";`
      // TODO is this really valid?
      assetUsedSymbols.size > 0 ||
      namespaceReexportedSymbols.size > 0
    ) {
      for (let dep of outgoingDeps) {
        if (dep.value.symbols.get('*')?.local === '*') {
          for (let s of namespaceReexportedSymbols) {
            // We need to propagate the namespaceReexportedSymbols to all namespace dependencies (= even wrong ones because we don't know yet)
            outgoingDepAddSymbol(dep, s);
          }
        }

        for (let [symbol, {local}] of dep.value.symbols) {
          // Was already handled above
          if (local === '*') continue;

          if (!assetSymbolsInverse || !dep.value.weakSymbols.has(symbol)) {
            // Bailout or non-weak symbol (= used in the asset itself = not a reexport)
            outgoingDepAddSymbol(dep, symbol);
          } else {
            let reexportedExportSymbol = assetSymbolsInverse.get(local);
            if (
              reexportedExportSymbol == null || // not reexported = used in asset itself
              assetUsedSymbols.has('*') || // we need everything
              assetUsedSymbols.has(reexportedExportSymbol) // reexported
            ) {
              if (reexportedExportSymbol != null) {
                // The symbol is indeed a reexport, so it's not used from the assset itself
                assetUsedSymbols.delete(reexportedExportSymbol);
              }
              outgoingDepAddSymbol(dep, symbol);
            }
          }
        }
      }
    }
    assetNode.usedSymbols = assetUsedSymbols;

    return hasDirtyOutgoingDep;
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
    this.replaceNodesConnectedTo(assetNode, depNodes);

    this.setUsedSymbolsAsset(assetNode, depNodes);

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
