// @flow strict-local

import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleGroup,
  CreateBundleOpts,
  Dependency as IDependency,
  GraphVisitor,
  BundlerBundleGraph as IBundlerBundleGraph,
  BundlerOptimizeBundleGraph as IBundlerOptimizeBundleGraph,
  BundlerBundleGraphTraversable,
  Target
} from '@parcel/types';
import type {ParcelOptions} from '../types';

import InternalBundleGraph from '../BundleGraph';
import {Bundle, bundleToInternalBundle} from './Bundle';
import {mapVisitor, ALL_EDGE_TYPES} from '../Graph';
import {assetFromValue, assetToInternalAsset} from './Asset';
import {getBundleGroupId} from '../utils';
import Dependency, {dependencyToInternalDependency} from './Dependency';

export class BundlerBundleGraph implements IBundlerBundleGraph {
  #graph; // InternalBundleGraph
  #options; // ParcelOptions

  constructor(graph: InternalBundleGraph, options: ParcelOptions) {
    this.#graph = graph;
    this.#options = options;
  }

  addAssetToBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.addAssetToBundle(
      assetToInternalAsset(asset).value,
      bundleToInternalBundle(bundle)
    );
  }

  addAssetGraphToBundle(
    asset: IAsset,
    bundle: IBundle,
    bundles: Array<IBundle>
  ) {
    this.#graph.addAssetGraphToBundle(
      assetToInternalAsset(asset).value,
      bundleToInternalBundle(bundle),
      bundles.map(bundleToInternalBundle)
    );
  }

  createBundleGroup(
    dependency: IDependency,
    target: Target,
    parentBundle: ?IBundle
  ): BundleGroup {
    return this.#graph.createBundleGroup(
      dependencyToInternalDependency(dependency),
      target,
      parentBundle ? bundleToInternalBundle(parentBundle) : null
    );
  }

  createBundle(opts: CreateBundleOpts): Bundle {
    return new Bundle(
      this.#graph.createBundle(opts),
      this.#graph,
      this.#options
    );
  }

  addBundleToBundleGroup(bundle: IBundle, bundleGroup: BundleGroup) {
    let bundleGroupId = getBundleGroupId(bundleGroup);
    this.#graph._graph.addEdge(bundleGroupId, bundle.id);
    this.#graph._graph.addEdge(bundleGroupId, bundle.id, 'bundle');
    for (let entryAsset of bundle.getEntryAssets()) {
      this.#graph._graph.removeEdge(bundleGroupId, entryAsset.id);
    }
  }

  createAssetReference(dependency: IDependency, asset: IAsset): void {
    return this.#graph.createAssetReference(
      dependencyToInternalDependency(dependency),
      assetToInternalAsset(asset).value
    );
  }

  getDependencyAssets(dependency: IDependency): Array<IAsset> {
    return this.#graph
      .getDependencyAssets(dependencyToInternalDependency(dependency))
      .map(asset => assetFromValue(asset, this.#options));
  }

  traverse<TContext>(
    visit: GraphVisitor<BundlerBundleGraphTraversable, TContext>
  ): ?TContext {
    return this.#graph._graph.filteredTraverse(
      node => {
        if (node.type === 'asset') {
          return {
            type: 'asset',
            value: assetFromValue(node.value, this.#options)
          };
        } else if (node.type === 'dependency') {
          return {type: 'dependency', value: new Dependency(node.value)};
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
  #options; // ParcelOptions

  constructor(graph: InternalBundleGraph, options: ParcelOptions) {
    super(graph, options);
    this.#graph = graph;
    this.#options = options;
  }

  findBundlesWithAsset(asset: IAsset): Array<IBundle> {
    return this.#graph
      .findBundlesWithAsset(assetToInternalAsset(asset).value)
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this.#graph.getBundleGroupsContainingBundle(
      bundleToInternalBundle(bundle)
    );
  }

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<IBundle> {
    return this.#graph
      .getBundlesInBundleGroup(bundleGroup)
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  getTotalSize(asset: IAsset, bundles: Array<IBundle>): number {
    return this.#graph.getTotalSize(
      assetToInternalAsset(asset).value,
      bundles.map(bundleToInternalBundle)
    );
  }

  isAssetInAncestorBundles(bundle: IBundle, asset: IAsset): boolean {
    return this.#graph.isAssetInAncestorBundles(
      bundleToInternalBundle(bundle),
      assetToInternalAsset(asset).value
    );
  }

  removeAssetGraphFromBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.removeAssetGraphFromBundle(
      assetToInternalAsset(asset).value,
      bundleToInternalBundle(bundle)
    );
  }

  removeAssetFromBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.removeAssetFromBundle(
      assetToInternalAsset(asset).value,
      bundleToInternalBundle(bundle)
    );
  }

  traverseBundles<TContext>(visit: GraphVisitor<IBundle, TContext>): ?TContext {
    return this.#graph.traverseBundles(
      mapVisitor(
        bundle => new Bundle(bundle, this.#graph, this.#options),
        visit
      )
    );
  }

  traverseContents<TContext>(
    visit: GraphVisitor<BundlerBundleGraphTraversable, TContext>
  ): ?TContext {
    return this.#graph.traverseContents(
      mapVisitor(
        node =>
          node.type === 'asset'
            ? {type: 'asset', value: assetFromValue(node.value, this.#options)}
            : {
                type: 'dependency',
                value: new Dependency(node.value)
              },
        visit
      )
    );
  }
}
