// @flow strict-local

import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleGraph as IBundleGraph,
  BundleGroup,
  Dependency as IDependency,
  GraphTraversalCallback,
  Symbol
} from '@parcel/types';
import type InternalBundleGraph from '../BundleGraph';

import invariant from 'assert';
import {assetToInternalAsset, Asset} from './Asset';
import {Bundle, bundleToInternalBundle} from './Bundle';
import {mapVisitor} from '../Graph';

export default class BundleGraph implements IBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    this.#graph = graph;
  }

  getDependencyResolution(dep: IDependency): ?Asset {
    let resolution = this.#graph.getDependencyResolution(dep);
    if (resolution) {
      return new Asset(resolution);
    }
  }

  getIncomingDependencies(asset: IAsset): Array<IDependency> {
    return this.#graph.getIncomingDependencies(assetToInternalAsset(asset));
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this.#graph.getBundleGroupsContainingBundle(
      bundleToInternalBundle(bundle)
    );
  }

  getBundleGroupsReferencedByBundle(
    bundle: IBundle
  ): Array<{bundleGroup: BundleGroup, dependency: IDependency}> {
    return this.#graph.getBundleGroupsReferencedByBundle(
      bundleToInternalBundle(bundle)
    );
  }

  getDependencies(asset: IAsset): Array<IDependency> {
    return this.#graph.getDependencies(assetToInternalAsset(asset));
  }

  isAssetInAncestorBundles(bundle: IBundle, asset: IAsset): boolean {
    let internalNode = this.#graph._graph.getNode(bundle.id);
    invariant(internalNode != null && internalNode.type === 'bundle');
    return this.#graph.isAssetInAncestorBundles(
      internalNode.value,
      assetToInternalAsset(asset)
    );
  }

  isAssetReferenced(asset: IAsset): boolean {
    return this.#graph.isAssetReferenced(assetToInternalAsset(asset));
  }

  isAssetReferencedByAssetType(asset: IAsset, type: string): boolean {
    return this.#graph.isAssetReferencedByAssetType(
      assetToInternalAsset(asset),
      type
    );
  }

  hasParentBundleOfType(bundle: IBundle, type: string): boolean {
    return this.#graph.hasParentBundleOfType(
      bundleToInternalBundle(bundle),
      type
    );
  }

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<IBundle> {
    return this.#graph
      .getBundlesInBundleGroup(bundleGroup)
      .map(bundle => new Bundle(bundle, this.#graph));
  }

  getBundles(): Array<IBundle> {
    return this.#graph
      .getBundles()
      .map(bundle => new Bundle(bundle, this.#graph));
  }

  resolveSymbol(asset: IAsset, symbol: Symbol) {
    return this.#graph.resolveSymbol(assetToInternalAsset(asset), symbol);
  }

  traverseBundles<TContext>(
    visit: GraphTraversalCallback<IBundle, TContext>
  ): ?TContext {
    return this.#graph.traverseBundles(
      mapVisitor(bundle => new Bundle(bundle, this.#graph), visit)
    );
  }
}
