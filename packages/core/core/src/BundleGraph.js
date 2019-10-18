// @flow strict-local

import type {
  BundleGroup,
  GraphVisitor,
  Symbol,
  TraversalActions
} from '@parcel/types';

import type {
  Asset,
  AssetNode,
  Bundle,
  BundleGraphNode,
  BundleGroupNode,
  Dependency,
  DependencyNode
} from './types';
import type AssetGraph from './AssetGraph';

import invariant from 'assert';
import crypto from 'crypto';
import nullthrows from 'nullthrows';
import {flatMap, objectSortedEntriesDeep} from '@parcel/utils';

import {getBundleGroupId} from './utils';
import Graph, {mapVisitor} from './Graph';

type BundleGraphEdgeTypes =
  // A lack of an edge type indicates to follow the edge while traversing
  // the bundle's contents, e.g. `bundle.traverse()` during packaging.
  | null
  // Used for constant-time checks of presence of a dependency or asset in a bundle,
  // avoiding bundle traversal in cases like `isAssetInAncestors`
  | 'contains'
  // Connections between bundles and bundle groups, for quick traversal of the
  // bundle hierarchy.
  | 'bundle'
  // Indicates that the asset a dependency references is contained in another bundle.
  // Using this type prevents referenced assets from being traversed normally.
  | 'references';

export default class BundleGraph {
  // TODO: These hashes are being invalidated in mutative methods, but this._graph is not a private
  // property so it is possible to reach in and mutate the graph without invalidating these hashes.
  // It needs to be exposed in BundlerRunner for now based on how applying runtimes works and the
  // BundlerRunner takes care of invalidating hashes when runtimes are applied, but this is not ideal.
  _bundleContentHashes: Map<string, string>;
  _graph: Graph<BundleGraphNode, BundleGraphEdgeTypes>;

  constructor({
    graph,
    bundleContentHashes
  }: {|
    graph: Graph<BundleGraphNode, BundleGraphEdgeTypes>,
    bundleContentHashes?: Map<string, string>
  |}) {
    this._graph = graph;
    this._bundleContentHashes = bundleContentHashes || new Map();
  }

  static deserialize(opts: {
    _graph: Graph<BundleGraphNode, BundleGraphEdgeTypes>,
    _bundleContentHashes: Map<string, string>,
    ...
  }): BundleGraph {
    return new BundleGraph({
      graph: opts._graph,
      bundleContentHashes: opts._bundleContentHashes
    });
  }

  addAssetGraphToBundle(asset: Asset, bundle: Bundle) {
    // The root asset should be reached directly from the bundle in traversal.
    // Its children will be traversed from there.
    this._graph.addEdge(bundle.id, asset.id);
    this._graph.traverse((node, _, actions) => {
      if (node.type === 'bundle_group') {
        actions.skipChildren();
        return;
      }

      if (node.type === 'asset' && !this.bundleHasAsset(bundle, node.value)) {
        bundle.stats.size += node.value.stats.size;
      }

      if (node.type === 'asset' || node.type === 'dependency') {
        this._graph.addEdge(bundle.id, node.id, 'contains');
      }

      if (node.type === 'dependency') {
        for (let bundleGroupNode of this._graph
          .getNodesConnectedFrom(node)
          .filter(node => node.type === 'bundle_group')) {
          this._graph.addEdge(bundle.id, bundleGroupNode.id, 'bundle');
        }
      }
    }, nullthrows(this._graph.getNode(asset.id)));
    this._bundleContentHashes.delete(bundle.id);
  }

  removeAssetGraphFromBundle(asset: Asset, bundle: Bundle) {
    // Remove all contains edges from the bundle to the nodes in the asset's
    // subgraph.
    this._graph.traverse((node, context, actions) => {
      if (node.type === 'bundle_group') {
        actions.skipChildren();
        return;
      }

      if (node.type === 'asset' || node.type === 'dependency') {
        if (this._graph.hasEdge(bundle.id, node.id, 'contains')) {
          this._graph.removeEdge(
            bundle.id,
            node.id,
            'contains',
            // Removing this contains edge should not orphan the connected node. This
            // is disabled for performance reasons as these edges are removed as part
            // of a traversal, and checking for orphans becomes quite expensive in
            // aggregate.
            false /* removeOrphans */
          );
          if (node.type === 'asset') {
            bundle.stats.size -= asset.stats.size;
          }
        } else {
          actions.skipChildren();
        }
      }

      if (node.type === 'dependency') {
        for (let bundleGroupNode of this._graph
          .getNodesConnectedFrom(node)
          .filter(node => node.type === 'bundle_group')) {
          let inboundDependencies = this._graph
            .getNodesConnectedTo(bundleGroupNode)
            .filter(node => node.type === 'dependency');

          // If every inbound dependency to this bundle group does not belong to this bundle,
          // then the connection between this bundle and the group is safe to remove.
          if (
            inboundDependencies.every(
              depNode => !this._graph.hasEdge(bundle.id, depNode.id, 'contains')
            )
          ) {
            this._graph.removeEdge(bundle.id, bundleGroupNode.id, 'bundle');
          }
        }
      }
    }, nullthrows(this._graph.getNode(asset.id)));

    // Remove the untyped edge from the bundle to the entry.
    if (this._graph.hasEdge(bundle.id, asset.id)) {
      this._graph.removeEdge(bundle.id, asset.id);
    }

    this._bundleContentHashes.delete(bundle.id);
  }

  createAssetReference(dependency: Dependency, asset: Asset): void {
    this._graph.addEdge(dependency.id, asset.id, 'references');
    if (this._graph.hasEdge(dependency.id, asset.id)) {
      this._graph.removeEdge(dependency.id, asset.id);
    }
  }

  findBundlesWithAsset(asset: Asset): Array<Bundle> {
    return this._graph
      .getNodesConnectedTo(
        nullthrows(this._graph.getNode(asset.id)),
        'contains'
      )
      .filter(node => node.type === 'bundle')
      .map(node => {
        invariant(node.type === 'bundle');
        return node.value;
      });
  }

  getDependencyAssets(dependency: Dependency): Array<Asset> {
    let dependencyNode = nullthrows(this._graph.getNode(dependency.id));
    return this._graph
      .getNodesConnectedFrom(dependencyNode)
      .filter(node => node.type === 'asset')
      .map(node => {
        invariant(node.type === 'asset');
        return node.value;
      });
  }

  getDependencyResolution(dep: Dependency): ?Asset {
    let depNode = this._graph.getNode(dep.id);
    if (!depNode) {
      return null;
    }

    let res = null;
    function findFirstAsset(node, _, traversal) {
      if (node.type === 'asset') {
        res = node.value;
        traversal.stop();
      } else if (node.id !== dep.id) {
        traversal.skipChildren();
      }
    }

    // TODO: Combine with multiple edge type traversal?
    this._graph.traverse(findFirstAsset, depNode);
    if (!res) {
      // Prefer real assets when resolving dependencies, but use the first
      // asset reference in absence of a real one.
      this._graph.traverse(findFirstAsset, depNode, 'references');
    }

    return res;
  }

  getDependencies(asset: Asset): Array<Dependency> {
    let node = this._graph.getNode(asset.id);
    if (!node) {
      throw new Error('Asset not found');
    }

    return this._graph.getNodesConnectedFrom(node).map(node => {
      invariant(node.type === 'dependency');
      return node.value;
    });
  }

  traverseAssets<TContext>(
    bundle: Bundle,
    visit: GraphVisitor<Asset, TContext>
  ): ?TContext {
    return this.traverseBundle(
      bundle,
      mapVisitor(node => (node.type === 'asset' ? node.value : null), visit)
    );
  }

  isAssetReferenced(asset: Asset): boolean {
    return (
      this._graph.getNodesConnectedTo(
        nullthrows(this._graph.getNode(asset.id)),
        'references'
      ).length > 0
    );
  }

  isAssetReferencedByAssetType(asset: Asset, type: string): boolean {
    let referringBundles = new Set(
      this._graph.getNodesConnectedTo(
        nullthrows(this._graph.getNode(asset.id)),
        'contains'
      )
    );

    // is `asset` referenced by a dependency from an asset of `type`
    return this._graph
      .getNodesConnectedTo(nullthrows(this._graph.getNode(asset.id)))
      .filter(node => {
        // Does this dependency belong to a bundle that does not include the
        // asset it resolves to? If so, this asset is needed by a bundle but
        // does not belong to it.
        return this._graph
          .getNodesConnectedTo(node, 'contains')
          .filter(node => node.type === 'bundle')
          .some(b => !referringBundles.has(b));
      })
      .map(node => {
        invariant(node.type === 'dependency');
        return this._graph.getNodesConnectedTo(node, null);
      })
      .reduce((acc, node) => acc.concat(node), ([]: Array<BundleGraphNode>))
      .filter(node => node.type === 'asset')
      .some(node => {
        invariant(node.type === 'asset');
        return node.value.type === type;
      });
  }

  hasParentBundleOfType(bundle: Bundle, type: string): boolean {
    return (
      this._graph
        .getNodesConnectedTo(
          nullthrows(this._graph.getNode(bundle.id)),
          'bundle'
        )
        .map(node => this._graph.getNodesConnectedTo(node, 'bundle'))
        .reduce((acc, v) => acc.concat(v), [])
        .filter(node => node.type === 'bundle' && node.value.type === type)
        .length > 0
    );
  }

  isAssetInAncestorBundles(bundle: Bundle, asset: Asset): boolean {
    let parentBundleNodes = flatMap(
      this._graph.getNodesConnectedTo(
        nullthrows(this._graph.getNode(bundle.id)),
        'bundle'
      ),
      bundleGroupNode => {
        invariant(bundleGroupNode.type === 'bundle_group');
        return this._graph.getNodesConnectedTo(bundleGroupNode, 'bundle');
      }
    );

    return parentBundleNodes.every(parentNode => {
      let inBundle;

      this._graph.traverseAncestors(
        parentNode,
        (node, ctx, actions) => {
          if (node.type !== 'bundle' || node.id === bundle.id) {
            return;
          }

          if (this._graph.hasEdge(node.value.id, asset.id, 'contains')) {
            inBundle = true;
            actions.stop();
          }
        },
        'bundle'
      );

      return inBundle;
    });
  }

  traverseBundle<TContext>(
    bundle: Bundle,
    visit: GraphVisitor<AssetNode | DependencyNode, TContext>
  ): ?TContext {
    return this._graph.filteredTraverse(
      (node, actions) => {
        if (node.id === bundle.id) {
          return;
        }

        if (node.type === 'dependency' || node.type === 'asset') {
          if (this._graph.hasEdge(bundle.id, node.id, 'contains')) {
            return node;
          }
        }

        actions.skipChildren();
      },
      visit,
      nullthrows(this._graph.getNode(bundle.id))
    );
  }

  traverseContents<TContext>(
    visit: GraphVisitor<AssetNode | DependencyNode, TContext>
  ): ?TContext {
    return this._graph.filteredTraverse(
      node =>
        node.type === 'asset' || node.type === 'dependency' ? node : null,
      visit
    );
  }

  hasChildBundles(bundle: Bundle): boolean {
    let bundleNode = nullthrows(this._graph.getNode(bundle.id));
    return this._graph.getNodesConnectedFrom(bundleNode, 'bundle').length > 0;
  }

  traverseBundles<TContext>(
    visit: GraphVisitor<Bundle, TContext>,
    startBundle?: Bundle
  ): ?TContext {
    return this._graph.filteredTraverse(
      node => (node.type === 'bundle' ? node.value : null),
      visit,
      startBundle ? nullthrows(this._graph.getNode(startBundle.id)) : null,
      'bundle'
    );
  }

  getBundles(): Array<Bundle> {
    let bundles = [];
    this.traverseBundles(bundle => {
      bundles.push(bundle);
    });

    return bundles;
  }

  getTotalSize(asset: Asset): number {
    let size = 0;
    this._graph.traverse((node, _, actions) => {
      if (node.type === 'bundle_group') {
        actions.skipChildren();
        return;
      }

      if (node.type === 'asset') {
        size += node.value.stats.size;
      }
    }, nullthrows(this._graph.getNode(asset.id)));
    return size;
  }

  getBundleGroupsContainingBundle(bundle: Bundle): Array<BundleGroup> {
    return this._graph
      .getNodesConnectedTo(nullthrows(this._graph.getNode(bundle.id)), 'bundle')
      .filter(node => node.type === 'bundle_group')
      .map(node => {
        invariant(node.type === 'bundle_group');
        return node.value;
      });
  }

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<Bundle> {
    return this._graph
      .getNodesConnectedFrom(
        nullthrows(this._graph.getNode(getBundleGroupId(bundleGroup))),
        'bundle'
      )
      .filter(node => node.type === 'bundle')
      .map(node => {
        invariant(node.type === 'bundle');
        return node.value;
      });
  }

  getBundleGroupsReferencedByBundle(
    bundle: Bundle
  ): Array<{
    bundleGroup: BundleGroup,
    dependency: Dependency,
    ...
  }> {
    let node = nullthrows(
      this._graph.getNode(bundle.id),
      'Bundle graph must contain bundle'
    );

    let groupNodes: Array<BundleGroupNode> = [];
    this._graph.traverse(
      (node, context, actions) => {
        if (node.type === 'bundle_group') {
          groupNodes.push(node);
          actions.skipChildren();
        }
      },
      node,
      'bundle'
    );

    return flatMap(groupNodes, groupNode => {
      return this._graph
        .getNodesConnectedTo(groupNode)
        .filter(
          node =>
            node.type === 'dependency' &&
            this._graph.hasEdge(bundle.id, node.id, 'contains')
        )
        .map(dependencyNode => {
          // TODO: Enforce non-null when bundle groups have the correct bundles
          // pointing to them
          invariant(dependencyNode.type === 'dependency');

          return {
            bundleGroup: groupNode.value,
            dependency: dependencyNode.value
          };
        });
    });
  }

  getIncomingDependencies(asset: Asset): Array<Dependency> {
    let node = this._graph.getNode(asset.id);
    if (!node) {
      return [];
    }

    return this._graph
      .findAncestors(node, node => node.type === 'dependency')
      .map(node => {
        invariant(node.type === 'dependency');
        return node.value;
      });
  }

  bundleHasAsset(bundle: Bundle, asset: Asset): boolean {
    return this._graph.hasEdge(bundle.id, asset.id, 'contains');
  }

  filteredTraverse<TValue, TContext>(
    bundle: Bundle,
    filter: (BundleGraphNode, TraversalActions) => ?TValue,
    visit: GraphVisitor<TValue, TContext>
  ): ?TContext {
    return this._graph.filteredTraverse(
      filter,
      visit,
      nullthrows(this._graph.getNode(bundle.id))
    );
  }

  resolveSymbol(asset: Asset, symbol: Symbol) {
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
        let resolvedAsset = nullthrows(this.getDependencyResolution(dep));
        let {asset, symbol: resolvedSymbol, exportSymbol} = this.resolveSymbol(
          resolvedAsset,
          depSymbol
        );

        // If it didn't resolve to anything (likely CommonJS), pass through where we got to
        if (resolvedSymbol == null) {
          return {asset, symbol: resolvedSymbol, exportSymbol};
        }

        // Otherwise, keep the original symbol name along with the resolved symbol
        return {asset, symbol: resolvedSymbol, exportSymbol: symbol};
      }

      // If this module exports wildcards, resolve the original module.
      // Default exports are excluded from wildcard exports.
      if (dep.symbols.get('*') === '*' && symbol !== 'default') {
        let resolved = nullthrows(this.getDependencyResolution(dep));
        let result = this.resolveSymbol(resolved, symbol);
        if (result.symbol != null) {
          return {
            asset: result.asset,
            symbol: result.symbol,
            exportSymbol: symbol
          };
        }
      }
    }

    return {asset, exportSymbol: symbol, symbol: identifier};
  }

  getExportedSymbols(asset: Asset) {
    let symbols = [];

    for (let symbol of asset.symbols.keys()) {
      symbols.push(this.resolveSymbol(asset, symbol));
    }

    let deps = this.getDependencies(asset);
    for (let dep of deps) {
      if (dep.symbols.get('*') === '*') {
        let resolved = nullthrows(this.getDependencyResolution(dep));
        let exported = this.getExportedSymbols(resolved).filter(
          s => s.exportSymbol !== 'default'
        );
        symbols.push(...exported);
      }
    }

    return symbols;
  }

  getContentHash(bundle: Bundle): string {
    let existingHash = this._bundleContentHashes.get(bundle.id);
    if (existingHash != null) {
      return existingHash;
    }

    let hash = crypto.createHash('md5');
    // TODO: sort??
    this.traverseAssets(bundle, asset => {
      hash.update([asset.outputHash, asset.filePath].join(':'));
    });

    let hashHex = hash.digest('hex');
    this._bundleContentHashes.set(bundle.id, hashHex);
    return hashHex;
  }

  getHash(bundle: Bundle): string {
    let hash = crypto.createHash('md5');
    this.traverseBundles(childBundle => {
      hash.update(this.getContentHash(childBundle));
    }, bundle);

    hash.update(JSON.stringify(objectSortedEntriesDeep(bundle.env)));
    return hash.digest('hex');
  }
}

export function removeAssetGroups(
  assetGraph: AssetGraph
): Graph<BundleGraphNode> {
  let graph = new Graph<BundleGraphNode>();

  let rootNode = assetGraph.getRootNode();
  invariant(rootNode != null && rootNode.type === 'root');
  graph.setRootNode(rootNode);

  let assetGroupIds = new Set();
  for (let [, node] of assetGraph.nodes) {
    if (node.type === 'asset_group') {
      assetGroupIds.add(node.id);
    } else {
      graph.addNode(node);
    }
  }

  for (let edge of assetGraph.getAllEdges()) {
    let fromIds;
    if (assetGroupIds.has(edge.from)) {
      fromIds = [...assetGraph.inboundEdges.get(edge.from).get(null)];
    } else {
      fromIds = [edge.from];
    }

    for (let from of fromIds) {
      if (assetGroupIds.has(edge.to)) {
        for (let to of assetGraph.outboundEdges.get(edge.to).get(null)) {
          graph.addEdge(from, to);
        }
      } else {
        graph.addEdge(from, edge.to);
      }
    }
  }

  return graph;
}
