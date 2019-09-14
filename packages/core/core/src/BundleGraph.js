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
import type Graph from './Graph';

import invariant from 'assert';
import crypto from 'crypto';
import nullthrows from 'nullthrows';

import {getBundleGroupId} from './utils';
import {mapVisitor} from './Graph';

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
  // A cache of bundle content hashes. Currently, a new BundleGraph is created in response
  // to any asset change, so this doesn't need much invalidation. However, currently namers run
  // before runtimes, and can access `getHash` despite runtimes altering bundle content later.
  // TODO: Implement invalidation since runtimes can alter bundle contents?
  _bundleContentHashes: Map<string, string> = new Map();
  _graph: Graph<BundleGraphNode, BundleGraphEdgeTypes>;

  constructor(graph: Graph<BundleGraphNode, BundleGraphEdgeTypes>) {
    this._graph = graph;
  }

  static deserialize(opts: {
    _graph: Graph<BundleGraphNode, BundleGraphEdgeTypes>,
    ...
  }): BundleGraph {
    return new BundleGraph(opts._graph);
  }

  addAssetToBundle(asset: Asset, bundle: Bundle) {
    // This asset should be reached via traversal
    this._graph.addEdge(bundle.id, asset.id);
    this._graph.addEdge(bundle.id, asset.id, 'contains');
  }

  addAssetGraphToBundle(asset: Asset, bundle: Bundle) {
    // The root asset should be reached directly from the bundle in traversal.
    // Its children will be traversed from there.
    this._graph.addEdge(bundle.id, asset.id);
    this._graph.traverse(node => {
      if (node.type === 'asset' || node.type === 'dependency') {
        this._graph.addEdge(bundle.id, node.id, 'contains');
      }
    }, nullthrows(this._graph.getNode(asset.id)));
  }

  removeAssetGraphFromBundle(asset: Asset, bundle: Bundle) {
    this._graph.removeEdge(bundle.id, asset.id);
    this._graph.traverse(node => {
      if (node.type === 'asset' || node.type === 'dependency') {
        this._graph.removeEdge(bundle.id, node.id, 'contains');
      }
    }, nullthrows(this._graph.getNode(asset.id)));
  }

  createAssetReference(dependency: Dependency, asset: Asset): void {
    this._graph.addEdge(dependency.id, asset.id, 'references');
    this._graph.removeEdge(dependency.id, asset.id);
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

  removeAssetFromBundle(asset: Asset, bundle: Bundle): void {
    this._graph.removeEdge(bundle.id, asset.id, 'contains');
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
    let parentNodes = this._graph.getNodesConnectedTo(
      nullthrows(this._graph.getNode(bundle.id)),
      'bundle'
    );

    return parentNodes.every(parentNode => {
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
    visit: GraphVisitor<AssetNode | DependencyNode, TContext>,
    includeAll: boolean = false
  ): ?TContext {
    return this._graph.filteredTraverse(
      (node, actions) => {
        if (node.id === bundle.id) {
          return;
        }

        if (node.type === 'dependency' || node.type === 'asset') {
          if (
            includeAll ||
            this._graph.hasEdge(bundle.id, node.id, 'contains')
          ) {
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

  getChildBundles(bundle: Bundle): Array<Bundle> {
    let bundleNode = nullthrows(this._graph.getNode(bundle.id));
    return this._graph
      .getNodesConnectedFrom(bundleNode, 'bundle')
      .filter(node => node.type === 'bundle')
      .map(node => {
        invariant(node.type === 'bundle');
        return node.value;
      });
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
    this._graph.traverse(node => {
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

    return (
      groupNodes
        .map(groupNode => {
          let dependencyNode = this._graph
            .getNodesConnectedTo(groupNode)
            .find(
              node =>
                node.type === 'dependency' &&
                this._graph.hasEdge(bundle.id, node.id, 'contains')
            );

          // TODO: Enforce non-null when bundle groups have the correct bundles
          // pointing to them
          invariant(
            dependencyNode == null || dependencyNode.type === 'dependency'
          );

          return {
            bundleGroup: groupNode.value,
            dependency: dependencyNode?.value
          };
        })
        // TODO: Remove this filter when bundle groups have the correct bundles
        // pointing to them
        .filter(({dependency}) => dependency != null)
        .map(({bundleGroup, dependency}) => {
          invariant(dependency != null);
          return {
            bundleGroup,
            dependency
          };
        })
    );
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

  getContentHash(bundle: Bundle): string {
    let existingHash = this._bundleContentHashes.get(bundle.id);
    if (existingHash != null) {
      return existingHash;
    }

    let hash = crypto.createHash('md5');
    // TODO: sort??
    this.traverseAssets(bundle, asset => {
      hash.update(asset.outputHash);
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

    return hash.digest('hex');
  }
}
