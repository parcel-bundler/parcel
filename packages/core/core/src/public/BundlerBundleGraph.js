// @flow strict-local

import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleGroup,
  CreateBundleOpts,
  Dependency,
  GraphVisitor,
  BundlerBundleGraph as IBundlerBundleGraph,
  BundlerOptimizeBundleGraph as IBundlerOptimizeBundleGraph,
  BundlerBundleGraphTraversable,
  Target
} from '@parcel/types';

import nullthrows from 'nullthrows';

import InternalBundleGraph from '../BundleGraph';
import {Bundle, bundleToInternalBundle} from './Bundle';
import {mapVisitor, ALL_EDGE_TYPES} from '../Graph';
import {Asset, assetToInternalAsset} from './Asset';
import {getBundleGroupId} from '../utils';

export class BundlerBundleGraph implements IBundlerBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    this.#graph = graph;
  }

  addAssetToBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.addAssetToBundle(
      assetToInternalAsset(asset),
      bundleToInternalBundle(bundle)
    );
  }

  addAssetGraphToBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.addAssetGraphToBundle(
      assetToInternalAsset(asset),
      bundleToInternalBundle(bundle)
    );
  }

  createBundleGroup(dependency: Dependency, target: Target): BundleGroup {
    let dependencyNode = this.#graph._graph.getNode(dependency.id);
    if (!dependencyNode) {
      throw new Error('Dependency not found');
    }

    let resolved = this.#graph.getDependencyResolution(dependency);
    if (!resolved) {
      throw new Error('Dependency did not resolve to an asset');
    }

    let bundleGroup: BundleGroup = {
      target,
      entryAssetId: resolved.id
    };

    let bundleGroupNode = {
      id: getBundleGroupId(bundleGroup),
      type: 'bundle_group',
      value: bundleGroup
    };

    this.#graph._graph.addNode(bundleGroupNode);
    let assetNodes = this.#graph._graph.getNodesConnectedFrom(dependencyNode);
    this.#graph._graph.replaceNodesConnectedTo(bundleGroupNode, assetNodes);
    this.#graph._graph.removeEdge(dependencyNode.id, resolved.id);
    this.#graph._graph.addEdge(dependencyNode.id, bundleGroupNode.id);

    // Traverse upward and connect this bundle group to the bundle(s) that reference it
    let connectedFromBundles = [];
    this.#graph._graph.traverseAncestors(
      dependencyNode,
      (node, context, actions) => {
        if (node.id === dependencyNode.id) {
          return;
        }

        if (node.type === 'bundle') {
          connectedFromBundles.push(node);
          actions.skipChildren();
        }
      }
    );

    if (connectedFromBundles.length > 0) {
      for (let bundleNode of connectedFromBundles) {
        this.#graph._graph.addEdge(bundleNode.id, bundleGroupNode.id, 'bundle');
      }
    } else {
      this.#graph._graph.addEdge(
        nullthrows(this.#graph._graph.getRootNode()).id,
        bundleGroupNode.id,
        'bundle'
      );
    }

    return bundleGroup;
  }

  createBundle(opts: CreateBundleOpts): Bundle {
    let bundleId = 'bundle:' + (opts.id ?? nullthrows(opts.entryAsset?.id));
    let bundleNode = {
      type: 'bundle',
      id: bundleId,
      value: {
        id: bundleId,
        type: opts.type ?? nullthrows(opts.entryAsset).type,
        env: opts.env ?? nullthrows(opts.entryAsset).env,
        entryAssetId: opts.entryAsset?.id,
        filePath: null,
        isEntry: opts.isEntry,
        target: opts.target,
        name: null,
        stats: {size: 0, time: 0}
      }
    };

    this.#graph._graph.addNode(bundleNode);
    if (opts.entryAsset != null) {
      this.#graph._graph.addEdge(bundleNode.id, opts.entryAsset.id);
    }

    return new Bundle(bundleNode.value, this.#graph);
  }

  addBundleToBundleGroup(bundle: IBundle, bundleGroup: BundleGroup) {
    let bundleGroupId = getBundleGroupId(bundleGroup);
    this.#graph._graph.addEdge(bundleGroupId, bundle.id);
    this.#graph._graph.addEdge(bundleGroupId, bundle.id, 'bundle');
    for (let entryAsset of bundle.getEntryAssets()) {
      this.#graph._graph.removeEdge(bundleGroupId, entryAsset.id);
    }
  }

  createAssetReference(dependency: Dependency, asset: IAsset): void {
    return this.#graph.createAssetReference(
      dependency,
      assetToInternalAsset(asset)
    );
  }

  getDependencyAssets(dependency: Dependency): Array<IAsset> {
    return this.#graph
      .getDependencyAssets(dependency)
      .map(asset => new Asset(asset));
  }

  traverse<TContext>(
    visit: GraphVisitor<BundlerBundleGraphTraversable, TContext>
  ): ?TContext {
    return this.#graph._graph.filteredTraverse(
      node => {
        if (node.type === 'asset') {
          return {type: 'asset', value: new Asset(node.value)};
        } else if (node.type === 'dependency') {
          return {type: 'dependency', value: node.value};
        }
      },
      visit,
      undefined, // start with root
      // $FlowFixMe
      ALL_EDGE_TYPES
    );
  }
}

export class BundlerOptimizeBundleGraph extends BundlerBundleGraph
  implements IBundlerOptimizeBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    super(graph);
    this.#graph = graph;
  }

  findBundlesWithAsset(asset: IAsset): Array<IBundle> {
    return this.#graph
      .findBundlesWithAsset(assetToInternalAsset(asset))
      .map(bundle => new Bundle(bundle, this.#graph));
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this.#graph.getBundleGroupsContainingBundle(
      bundleToInternalBundle(bundle)
    );
  }

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<IBundle> {
    return this.#graph
      .getBundlesInBundleGroup(bundleGroup)
      .map(bundle => new Bundle(bundle, this.#graph));
  }

  getDependenciesInBundle(bundle: IBundle, asset: IAsset): Array<Dependency> {
    return this.#graph.getDependenciesInBundle(
      bundleToInternalBundle(bundle),
      assetToInternalAsset(asset)
    );
  }

  getTotalSize(asset: IAsset): number {
    return this.#graph.getTotalSize(assetToInternalAsset(asset));
  }

  isAssetInAncestorBundles(bundle: IBundle, asset: IAsset): boolean {
    return this.#graph.isAssetInAncestorBundles(
      bundleToInternalBundle(bundle),
      assetToInternalAsset(asset)
    );
  }

  removeAssetGraphFromBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.removeAssetGraphFromBundle(
      assetToInternalAsset(asset),
      bundleToInternalBundle(bundle)
    );
  }

  removeAssetFromBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.removeAssetFromBundle(
      assetToInternalAsset(asset),
      bundleToInternalBundle(bundle)
    );
  }

  traverseBundles<TContext>(visit: GraphVisitor<IBundle, TContext>): ?TContext {
    return this.#graph.traverseBundles(
      mapVisitor(bundle => new Bundle(bundle, this.#graph), visit)
    );
  }

  traverseContents<TContext>(
    visit: GraphVisitor<BundlerBundleGraphTraversable, TContext>
  ): ?TContext {
    return this.#graph.traverseContents(
      mapVisitor(
        node =>
          node.type === 'asset'
            ? {type: 'asset', value: new Asset(node.value)}
            : {
                type: 'dependency',
                value: node.value
              },
        visit
      )
    );
  }
}
