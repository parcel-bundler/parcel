// @flow strict-local

import type {
  BundleGroup,
  GraphVisitor,
  Symbol,
  TraversalActions,
} from '@parcel/types';

import type {
  Asset,
  AssetNode,
  Bundle,
  BundleGraphNode,
  Dependency,
  DependencyNode,
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
  | 'references'
  | 'internal_async';

export default class BundleGraph {
  // TODO: These hashes are being invalidated in mutative methods, but this._graph is not a private
  // property so it is possible to reach in and mutate the graph without invalidating these hashes.
  // It needs to be exposed in BundlerRunner for now based on how applying runtimes works and the
  // BundlerRunner takes care of invalidating hashes when runtimes are applied, but this is not ideal.
  _bundleContentHashes: Map<string, string>;
  _graph: Graph<BundleGraphNode, BundleGraphEdgeTypes>;

  constructor({
    graph,
    bundleContentHashes,
  }: {|
    graph: Graph<BundleGraphNode, BundleGraphEdgeTypes>,
    bundleContentHashes?: Map<string, string>,
  |}) {
    this._graph = graph;
    this._bundleContentHashes = bundleContentHashes || new Map();
  }

  static deserialize(opts: {|
    _graph: Graph<BundleGraphNode, BundleGraphEdgeTypes>,
    _bundleContentHashes: Map<string, string>,
  |}): BundleGraph {
    return new BundleGraph({
      graph: opts._graph,
      bundleContentHashes: opts._bundleContentHashes,
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

  internalizeAsyncDependency(bundle: Bundle, dependency: Dependency) {
    if (!dependency.isAsync) {
      throw new Error('Expected an async dependency');
    }

    this._graph.addEdge(bundle.id, dependency.id, 'internal_async');
    this.removeExternalDependency(bundle, dependency);
  }

  isDependencyDeferred(dependency: Dependency): boolean {
    let node = this._graph.getNode(dependency.id);
    invariant(node && node.type === 'dependency');
    return !!node.hasDeferred;
  }

  getParentBundlesOfBundleGroup(bundleGroup: BundleGroup): Array<Bundle> {
    return this._graph
      .getNodesConnectedTo(
        nullthrows(this._graph.getNode(getBundleGroupId(bundleGroup))),
        'bundle',
      )
      .filter(node => node.type === 'bundle')
      .map(node => {
        invariant(node.type === 'bundle');
        return node.value;
      });
  }

  resolveExternalDependency(
    dependency: Dependency,
    bundle: ?Bundle,
  ): ?(
    | {|type: 'bundle_group', value: BundleGroup|}
    | {|type: 'asset', value: Asset|}
  ) {
    if (
      bundle != null &&
      this._graph.hasEdge(bundle.id, dependency.id, 'internal_async')
    ) {
      let resolved = this.getDependencyResolution(dependency, bundle);
      if (resolved == null) {
        return;
      } else {
        return {
          type: 'asset',
          value: resolved,
        };
      }
    }

    let node = this._graph
      .getNodesConnectedFrom(nullthrows(this._graph.getNode(dependency.id)))
      .find(node => node.type === 'bundle_group');

    if (node == null) {
      return;
    }

    invariant(node.type === 'bundle_group');
    return {
      type: 'bundle_group',
      value: node.value,
    };
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
            false /* removeOrphans */,
          );
          if (node.type === 'asset') {
            bundle.stats.size -= asset.stats.size;
          }
        } else {
          actions.skipChildren();
        }
      }

      if (node.type === 'dependency') {
        this.removeExternalDependency(bundle, node.value);
      }
    }, nullthrows(this._graph.getNode(asset.id)));

    // Remove the untyped edge from the bundle to the entry.
    if (this._graph.hasEdge(bundle.id, asset.id)) {
      this._graph.removeEdge(bundle.id, asset.id);
    }

    this._bundleContentHashes.delete(bundle.id);
  }

  removeExternalDependency(bundle: Bundle, dependency: Dependency) {
    for (let bundleGroupNode of this._graph
      .getNodesConnectedFrom(nullthrows(this._graph.getNode(dependency.id)))
      .filter(node => node.type === 'bundle_group')) {
      let inboundDependencies = this._graph
        .getNodesConnectedTo(bundleGroupNode)
        .filter(node => node.type === 'dependency')
        .map(node => {
          invariant(node.type === 'dependency');
          return node.value;
        });

      // If every inbound dependency to this bundle group does not belong to this bundle,
      // or the dependency is internal to the bundle, then the connection between
      // this bundle and the group is safe to remove.
      if (
        inboundDependencies.every(
          dependency =>
            !this.bundleHasDependency(bundle, dependency) ||
            this._graph.hasEdge(bundle.id, dependency.id, 'internal_async'),
        )
      ) {
        this._graph.removeEdge(bundle.id, bundleGroupNode.id, 'bundle');
      }
    }
  }

  createAssetReference(dependency: Dependency, asset: Asset): void {
    this._graph.addEdge(dependency.id, asset.id, 'references');
    if (this._graph.hasEdge(dependency.id, asset.id)) {
      this._graph.removeEdge(dependency.id, asset.id);
    }
  }

  createBundleReference(from: Bundle, to: Bundle): void {
    this._graph.addEdge(from.id, to.id, 'references');
  }

  findBundlesWithAsset(asset: Asset): Array<Bundle> {
    return this._graph
      .getNodesConnectedTo(
        nullthrows(this._graph.getNode(asset.id)),
        'contains',
      )
      .filter(node => node.type === 'bundle')
      .map(node => {
        invariant(node.type === 'bundle');
        return node.value;
      });
  }

  findBundlesWithDependency(dependency: Dependency): Array<Bundle> {
    return this._graph
      .getNodesConnectedTo(
        nullthrows(this._graph.getNode(dependency.id)),
        'contains',
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

  getDependencyResolution(dep: Dependency, bundle: ?Bundle): ?Asset {
    let depNode = this._graph.getNode(dep.id);
    if (!depNode) {
      return null;
    }

    let assets = this.getDependencyAssets(dep);
    let firstAsset = assets[0];
    let resolved =
      // If no bundle is specified, use the first concrete asset.
      bundle == null
        ? firstAsset
        : // Otherwise, find the first asset that belongs to this bundle.
          assets.find(asset => this.bundleHasAsset(bundle, asset)) ||
          firstAsset;

    // If a resolution still hasn't been found, return the first referenced asset.
    if (resolved == null) {
      this._graph.traverse(
        (node, _, traversal) => {
          if (node.type === 'asset') {
            resolved = node.value;
            traversal.stop();
          } else if (node.id !== dep.id) {
            traversal.skipChildren();
          }
        },
        depNode,
        'references',
      );
    }

    return resolved;
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
    visit: GraphVisitor<Asset, TContext>,
  ): ?TContext {
    return this.traverseBundle(
      bundle,
      mapVisitor(node => (node.type === 'asset' ? node.value : null), visit),
    );
  }

  isAssetReferenced(asset: Asset): boolean {
    return (
      this._graph.getNodesConnectedTo(
        nullthrows(this._graph.getNode(asset.id)),
        'references',
      ).length > 0
    );
  }

  isAssetReferencedByDependant(
    bundle: Bundle,
    asset: Asset,
    visitedBundles: Set<Bundle> = new Set(),
  ): boolean {
    let dependencies = this._graph
      .getNodesConnectedTo(nullthrows(this._graph.getNode(asset.id)))
      .filter(node => node.type === 'dependency')
      .map(node => {
        invariant(node.type === 'dependency');
        return node.value;
      });

    const bundleHasReference = (bundle: Bundle) => {
      return (
        !this.bundleHasAsset(bundle, asset) &&
        dependencies.some(dependency =>
          this.bundleHasDependency(bundle, dependency),
        )
      );
    };

    let isReferenced = false;
    this.traverseBundles((descendant, _, actions) => {
      if (visitedBundles.has(descendant)) {
        actions.skipChildren();
        return;
      }

      visitedBundles.add(descendant);
      if (
        descendant.type !== bundle.type ||
        descendant.env.context !== bundle.env.context
      ) {
        actions.skipChildren();
        return;
      }

      if (descendant !== bundle && bundleHasReference(descendant)) {
        isReferenced = true;
        actions.stop();
        return;
      }

      let similarSiblings = this.getSiblingBundles(descendant).filter(
        sibling =>
          sibling.type === bundle.type &&
          sibling.env.context === bundle.env.context,
      );
      if (
        similarSiblings.some(
          sibling =>
            bundleHasReference(sibling) ||
            this.isAssetReferencedByDependant(sibling, asset, visitedBundles),
        )
      ) {
        isReferenced = true;
        actions.stop();
        return;
      }
    }, bundle);

    return isReferenced;
  }

  hasParentBundleOfType(bundle: Bundle, type: string): boolean {
    let parents = this.getParentBundles(bundle);
    return parents.length > 0 && parents.every(parent => parent.type === type);
  }

  getParentBundles(bundle: Bundle): Array<Bundle> {
    return flatMap(
      this._graph.getNodesConnectedTo(
        nullthrows(this._graph.getNode(bundle.id)),
        'bundle',
      ),
      bundleGroupNode =>
        this._graph
          .getNodesConnectedTo(bundleGroupNode, 'bundle')
          // Entry bundle groups have the root node as their parent
          .filter(node => node.type !== 'root'),
    ).map(node => {
      invariant(node.type === 'bundle');
      return node.value;
    });
  }

  isAssetReachableFromBundle(asset: Asset, bundle: Bundle): boolean {
    // For an asset to be reachable from a bundle, it must either exist in a sibling bundle,
    // or in an ancestor bundle group reachable from all parent bundles.
    let bundleGroups = this.getBundleGroupsContainingBundle(bundle);
    return bundleGroups.every(bundleGroup => {
      // If the asset is in any sibling bundles of the original bundle, it is reachable.
      let bundles = this.getBundlesInBundleGroup(bundleGroup);
      if (
        bundles.some(b => b.id !== bundle.id && this.bundleHasAsset(b, asset))
      ) {
        return true;
      }

      // Get a list of parent bundle nodes pointing to the bundle group
      let parentBundleNodes = this._graph.getNodesConnectedTo(
        nullthrows(this._graph.getNode(getBundleGroupId(bundleGroup))),
        'bundle',
      );

      // Check that every parent bundle has a bundle group in its ancestry that contains the asset.
      return parentBundleNodes.every(bundleNode => {
        let inBundle = false;

        this._graph.traverseAncestors(
          bundleNode,
          (node, ctx, actions) => {
            if (node.type === 'bundle_group') {
              let childBundles = this.getBundlesInBundleGroup(node.value);
              if (
                childBundles.some(
                  b => b.id !== bundle.id && this.bundleHasAsset(b, asset),
                )
              ) {
                inBundle = true;
                actions.stop();
              }
            }

            // Don't deduplicate when context changes
            if (
              node.type === 'bundle' &&
              node.value.env.context !== bundle.env.context
            ) {
              actions.skipChildren();
            }
          },
          'bundle',
        );

        return inBundle;
      });
    });
  }

  findReachableBundleWithAsset(bundle: Bundle, asset: Asset) {
    let bundleGroups = this.getBundleGroupsContainingBundle(bundle);

    for (let bundleGroup of bundleGroups) {
      // If the asset is in any sibling bundles, return that bundle.
      let bundles = this.getBundlesInBundleGroup(bundleGroup);
      let res = bundles.find(
        b => b.id !== bundle.id && this.bundleHasAsset(b, asset),
      );
      if (res != null) {
        return res;
      }

      // Get a list of parent bundle nodes pointing to the bundle group
      let parentBundleNodes = this._graph.getNodesConnectedTo(
        nullthrows(this._graph.getNode(getBundleGroupId(bundleGroup))),
        'bundle',
      );

      // Find the nearest ancestor bundle that includes the asset.
      for (let bundleNode of parentBundleNodes) {
        this._graph.traverseAncestors(
          bundleNode,
          (node, ctx, actions) => {
            if (node.type === 'bundle_group') {
              let childBundles = this.getBundlesInBundleGroup(node.value);

              res = childBundles.find(
                b => b.id !== bundle.id && this.bundleHasAsset(b, asset),
              );
              if (res != null) {
                actions.stop();
              }
            }

            // Stop when context changes
            if (
              node.type === 'bundle' &&
              node.value.env.context !== bundle.env.context
            ) {
              actions.skipChildren();
            }
          },
          'bundle',
        );

        if (res != null) {
          return res;
        }
      }
    }
  }

  traverseBundle<TContext>(
    bundle: Bundle,
    visit: GraphVisitor<AssetNode | DependencyNode, TContext>,
  ): ?TContext {
    let entries = true;

    // A modified DFS traversal which traverses entry assets in the same order
    // as their ids appear in `bundle.entryAssetIds`.
    return this._graph.dfs({
      visit: mapVisitor((node, actions) => {
        if (node.id === bundle.id) {
          return;
        }

        if (node.type === 'dependency' || node.type === 'asset') {
          if (this._graph.hasEdge(bundle.id, node.id, 'contains')) {
            return node;
          }
        }

        actions.skipChildren();
      }, visit),
      startNode: nullthrows(this._graph.getNode(bundle.id)),
      getChildren: node => {
        let children = this._graph.getNodesConnectedFrom(nullthrows(node));
        let sorted =
          entries && bundle.entryAssetIds.length > 0
            ? children.sort((a, b) => {
                let aIndex = bundle.entryAssetIds.indexOf(a.id);
                let bIndex = bundle.entryAssetIds.indexOf(b.id);

                if (aIndex === bIndex) {
                  // If both don't exist in the entry asset list, or
                  // otherwise have the same index.
                  return 0;
                } else if (aIndex === -1) {
                  return 1;
                } else if (bIndex === -1) {
                  return -1;
                }

                return aIndex - bIndex;
              })
            : children;

        entries = false;
        return sorted;
      },
    });
  }

  traverseContents<TContext>(
    visit: GraphVisitor<AssetNode | DependencyNode, TContext>,
  ): ?TContext {
    return this._graph.filteredTraverse(
      node =>
        node.type === 'asset' || node.type === 'dependency' ? node : null,
      visit,
    );
  }

  getChildBundles(bundle: Bundle): Array<Bundle> {
    let bundles = [];
    this.traverseBundles((b, _, actions) => {
      if (bundle.id === b.id) {
        return;
      }

      bundles.push(b);
      actions.skipChildren();
    }, bundle);
    return bundles;
  }

  traverseBundles<TContext>(
    visit: GraphVisitor<Bundle, TContext>,
    startBundle: ?Bundle,
  ): ?TContext {
    return this._graph.filteredTraverse(
      node => (node.type === 'bundle' ? node.value : null),
      visit,
      startBundle ? nullthrows(this._graph.getNode(startBundle.id)) : null,
      'bundle',
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
        'bundle',
      )
      .filter(node => node.type === 'bundle')
      .map(node => {
        invariant(node.type === 'bundle');
        return node.value;
      });
  }

  getSiblingBundles(bundle: Bundle): Array<Bundle> {
    let siblings = [];

    let bundleGroups = this.getBundleGroupsContainingBundle(bundle);
    for (let bundleGroup of bundleGroups) {
      let bundles = this.getBundlesInBundleGroup(bundleGroup);
      for (let b of bundles) {
        if (b.id !== bundle.id) {
          siblings.push(b);
        }
      }
    }

    return siblings;
  }

  getReferencedBundles(bundle: Bundle): Array<Bundle> {
    let bundles = [];
    this._graph.traverse(
      (node, _, traversal) => {
        if (node.type === 'bundle') {
          bundles.push(node.value);
          traversal.stop();
        } else if (node.id !== bundle.id) {
          traversal.skipChildren();
        }
      },
      nullthrows(this._graph.getNode(bundle.id)),
      'references',
    );
    return bundles;
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

  bundleHasDependency(bundle: Bundle, dependency: Dependency): boolean {
    return this._graph.hasEdge(bundle.id, dependency.id, 'contains');
  }

  filteredTraverse<TValue, TContext>(
    bundle: Bundle,
    filter: (BundleGraphNode, TraversalActions) => ?TValue,
    visit: GraphVisitor<TValue, TContext>,
  ): ?TContext {
    return this._graph.filteredTraverse(
      filter,
      visit,
      nullthrows(this._graph.getNode(bundle.id)),
    );
  }

  resolveSymbol(asset: Asset, symbol: Symbol, boundary: ?Bundle) {
    let assetOutside = boundary && !this.bundleHasAsset(boundary, asset);

    let identifier = asset.symbols?.get(symbol)?.local;
    if (symbol === '*') {
      return {
        asset,
        exportSymbol: '*',
        symbol: identifier ?? null,
        loc: asset.symbols?.get(symbol)?.loc,
      };
    }

    let bailout = !asset.symbols;
    let deps = this.getDependencies(asset).reverse();
    let potentialResults = [];
    for (let dep of deps) {
      // If this is a re-export, find the original module.
      let symbolLookup = new Map(
        [...dep.symbols].map(([key, val]) => [val.local, key]),
      );
      let depSymbol = symbolLookup.get(identifier);
      if (depSymbol != null) {
        let resolved = this.getDependencyResolution(dep);
        if (!resolved) {
          // External module
          bailout = true;
          break;
        }

        if (assetOutside) {
          // We found the symbol, but `asset` is outside, return `asset` and the original symbol
          bailout = true;
          break;
        }

        let {
          asset: resolvedAsset,
          symbol: resolvedSymbol,
          exportSymbol,
          loc,
        } = this.resolveSymbol(resolved, depSymbol, boundary);

        if (!loc) {
          // Remember how we got there
          loc = asset.symbols?.get(symbol)?.loc;
        }

        return {
          asset: resolvedAsset,
          symbol: resolvedSymbol,
          exportSymbol,
          loc,
        };
      }

      // If this module exports wildcards, resolve the original module.
      // Default exports are excluded from wildcard exports.
      if (dep.symbols.get('*')?.local === '*' && symbol !== 'default') {
        let resolved = this.getDependencyResolution(dep);
        if (!resolved) continue;
        let result = this.resolveSymbol(resolved, symbol, boundary);

        // Either result.symbol is a string (found) or null with a wildcard (found)
        if (
          result.symbol != undefined ||
          (result.symbol === null && result.exportSymbol === '*')
        ) {
          if (assetOutside) {
            // We found the symbol, but `asset` is outside, return `asset` and the original symbol
            bailout = true;
            break;
          }

          return {
            asset: result.asset,
            symbol: result.symbol,
            exportSymbol: result.exportSymbol,
            loc: resolved.symbols?.get(symbol)?.loc,
          };
        }
        if (!result.asset.symbols) {
          // We didn't find it in this dependency, but it might still be there: bailout.
          // Continue searching though, with the assumption that there are no conficting reexports
          // and there might be a another (re)export (where we might statically find the symbol).
          potentialResults.push({
            asset: result.asset,
            symbol: result.symbol,
            exportSymbol: result.exportSymbol,
            loc: resolved.symbols?.get(symbol)?.loc,
          });
          bailout = true;
        }
      }
    }

    // We didn't find the exact symbol...
    if (potentialResults.length == 1) {
      // ..., but if it does exist, it's has to be behind this one reexport.
      return potentialResults[0];
    } else {
      // ... and there is no single reexport, but `bailout` tells us if it might still be exported.
      return {
        asset,
        exportSymbol: symbol,
        symbol: identifier ?? (bailout ? null : undefined),
        loc: asset.symbols?.get(symbol)?.loc,
      };
    }
  }

  getExportedSymbols(asset: Asset) {
    if (!asset.symbols) {
      return [];
    }

    let symbols = [];

    for (let symbol of asset.symbols.keys()) {
      symbols.push({...this.resolveSymbol(asset, symbol), exportAs: symbol});
    }

    let deps = this.getDependencies(asset);
    for (let dep of deps) {
      if (dep.symbols.get('*')?.local === '*') {
        let resolved = this.getDependencyResolution(dep);
        if (!resolved) continue;
        let exported = this.getExportedSymbols(resolved)
          .filter(s => s.exportSymbol !== 'default')
          .map(s => ({...s, exportAs: s.exportSymbol}));
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
      hash.update(
        [asset.outputHash, asset.filePath, asset.type, asset.uniqueKey].join(
          ':',
        ),
      );
    });

    let hashHex = hash.digest('hex');
    this._bundleContentHashes.set(bundle.id, hashHex);
    return hashHex;
  }

  getHash(bundle: Bundle): string {
    let hash = crypto.createHash('md5');
    this.traverseBundles((childBundle, ctx, traversal) => {
      if (childBundle.id === bundle.id || childBundle.isInline) {
        hash.update(this.getContentHash(childBundle));
      } else {
        hash.update(childBundle.id);
        traversal.skipChildren();
      }
      return {parentBundle: childBundle.id};
    }, bundle);

    hash.update(JSON.stringify(objectSortedEntriesDeep(bundle.env)));
    return hash.digest('hex');
  }
}

export function removeAssetGroups(
  assetGraph: AssetGraph,
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
