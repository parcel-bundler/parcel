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
import type {ParcelOptions} from '../types';
import type InternalBundleGraph from '../BundleGraph';

import invariant from 'assert';
import {assetFromValue, assetToInternalAsset, Asset} from './Asset';
import {Bundle, bundleToInternalBundle} from './Bundle';
import Dependency, {dependencyToInternalDependency} from './Dependency';
import {mapVisitor} from '../Graph';

export default class BundleGraph implements IBundleGraph {
  #graph; // InternalBundleGraph
  #options; // ParcelOptions

  constructor(graph: InternalBundleGraph, options: ParcelOptions) {
    this.#graph = graph;
    this.#options = options;
  }

  getAssetById(assetId: string): ?Asset {
    let internalAsset = this.#graph.getAssetById(assetId);
    if (internalAsset) {
      return assetFromValue(internalAsset, this.#options);
    }
  }

  getDependencyResolution(dep: IDependency): ?Asset {
    let resolution = this.#graph.getDependencyResolution(
      dependencyToInternalDependency(dep)
    );
    if (resolution) {
      return assetFromValue(resolution, this.#options);
    }
  }

  getIncomingDependencies(asset: IAsset): Array<IDependency> {
    return this.#graph
      .getIncomingDependencies(assetToInternalAsset(asset).value)
      .map(dep => new Dependency(dep));
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this.#graph.getBundleGroupsContainingBundle(
      bundleToInternalBundle(bundle)
    );
  }

  getBundleGroupsReferencedByBundle(
    bundle: IBundle
  ): Array<{
    bundleGroup: BundleGroup,
    dependency: IDependency,
    ...
  }> {
    return this.#graph
      .getBundleGroupsReferencedByBundle(bundleToInternalBundle(bundle))
      .map(({bundleGroup, dependency}) => ({
        bundleGroup,
        dependency: new Dependency(dependency)
      }));
  }

  getDependencies(asset: IAsset): Array<IDependency> {
    return this.#graph
      .getDependencies(assetToInternalAsset(asset).value)
      .map(dep => new Dependency(dep));
  }

  isAssetInAncestorBundles(bundle: IBundle, asset: IAsset): boolean {
    let internalNode = this.#graph._graph.getNode(bundle.id);
    invariant(internalNode != null && internalNode.type === 'bundle');
    return this.#graph.isAssetInAncestorBundles(
      internalNode.value,
      assetToInternalAsset(asset).value
    );
  }

  isAssetReferenced(asset: IAsset): boolean {
    return this.#graph.isAssetReferenced(assetToInternalAsset(asset).value);
  }

  isAssetReferencedByAssetType(asset: IAsset, type: string): boolean {
    return this.#graph.isAssetReferencedByAssetType(
      assetToInternalAsset(asset).value,
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
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  getBundles(): Array<IBundle> {
    return this.#graph
      .getBundles()
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  resolveSymbol(asset: IAsset, symbol: Symbol) {
    let res = this.#graph.resolveSymbol(
      assetToInternalAsset(asset).value,
      symbol
    );
    return {
      asset: assetFromValue(res.asset, this.#options),
      exportSymbol: res.exportSymbol,
      symbol: res.symbol
    };
  }

  traverseBundles<TContext>(
    visit: GraphTraversalCallback<IBundle, TContext>
  ): ?TContext {
    return this.#graph.traverseBundles(
      mapVisitor(
        bundle => new Bundle(bundle, this.#graph, this.#options),
        visit
      )
    );
  }
}
