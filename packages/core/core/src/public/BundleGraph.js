// @flow strict-local

import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleGraph as IBundleGraph,
  BundleGroup,
  Dependency as IDependency,
  GraphVisitor,
  Symbol,
  SymbolResolution,
} from '@parcel/types';
import type {ParcelOptions} from '../types';
import type InternalBundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {DefaultWeakMap} from '@parcel/utils';

import {assetFromValue, assetToAssetValue} from './Asset';
import {Bundle, bundleToInternalBundle} from './Bundle';
import Dependency, {dependencyToInternalDependency} from './Dependency';
import {mapVisitor} from '../Graph';

const internalBundleGraphToBundleGraph: DefaultWeakMap<
  ParcelOptions,
  WeakMap<InternalBundleGraph, BundleGraph>,
> = new DefaultWeakMap(() => new WeakMap());
// Friendly access for other modules within this package that need access
// to the internal bundle.
const _bundleGraphToInternalBundleGraph: WeakMap<
  IBundleGraph,
  InternalBundleGraph,
> = new WeakMap();
export function bundleGraphToInternalBundleGraph(
  bundleGraph: IBundleGraph,
): InternalBundleGraph {
  return nullthrows(_bundleGraphToInternalBundleGraph.get(bundleGraph));
}

export default class BundleGraph implements IBundleGraph {
  #graph; // InternalBundleGraph
  #options; // ParcelOptions

  constructor(graph: InternalBundleGraph, options: ParcelOptions) {
    let existing = internalBundleGraphToBundleGraph.get(options).get(graph);
    if (existing != null) {
      return existing;
    }

    this.#graph = graph;
    this.#options = options;
    _bundleGraphToInternalBundleGraph.set(this, graph);
    internalBundleGraphToBundleGraph.get(options).set(graph, this);
  }

  getDependencyResolution(dep: IDependency, bundle: ?IBundle): ?IAsset {
    let resolution = this.#graph.getDependencyResolution(
      dependencyToInternalDependency(dep),
      bundle && bundleToInternalBundle(bundle),
    );
    if (resolution) {
      return assetFromValue(resolution, this.#options);
    }
  }

  getIncomingDependencies(asset: IAsset): Array<IDependency> {
    return this.#graph
      .getIncomingDependencies(assetToAssetValue(asset))
      .map(dep => new Dependency(dep));
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this.#graph.getBundleGroupsContainingBundle(
      bundleToInternalBundle(bundle),
    );
  }

  getSiblingBundles(bundle: IBundle): Array<IBundle> {
    return this.#graph
      .getSiblingBundles(bundleToInternalBundle(bundle))
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  resolveExternalDependency(
    dependency: IDependency,
    bundle: ?IBundle,
  ): ?(
    | {|type: 'bundle_group', value: BundleGroup|}
    | {|type: 'asset', value: IAsset|}
  ) {
    let resolved = this.#graph.resolveExternalDependency(
      dependencyToInternalDependency(dependency),
      bundle && bundleToInternalBundle(bundle),
    );

    if (resolved == null) {
      return;
    } else if (resolved.type === 'bundle_group') {
      return resolved;
    }

    return {
      type: 'asset',
      value: assetFromValue(resolved.value, this.#options),
    };
  }

  getDependencies(asset: IAsset): Array<IDependency> {
    return this.#graph
      .getDependencies(assetToAssetValue(asset))
      .map(dep => new Dependency(dep));
  }

  isAssetInAncestorBundles(bundle: IBundle, asset: IAsset): boolean {
    let internalNode = this.#graph._graph.getNode(bundle.id);
    invariant(internalNode != null && internalNode.type === 'bundle');
    return this.#graph.isAssetInAncestorBundles(
      internalNode.value,
      assetToAssetValue(asset),
    );
  }

  isAssetReferenced(asset: IAsset): boolean {
    return this.#graph.isAssetReferenced(assetToAssetValue(asset));
  }

  isAssetReferencedByDependant(bundle: IBundle, asset: IAsset): boolean {
    return this.#graph.isAssetReferencedByDependant(
      bundleToInternalBundle(bundle),
      assetToAssetValue(asset),
    );
  }

  hasParentBundleOfType(bundle: IBundle, type: string): boolean {
    return this.#graph.hasParentBundleOfType(
      bundleToInternalBundle(bundle),
      type,
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

  getChildBundles(bundle: IBundle): Array<IBundle> {
    return this.#graph
      .getChildBundles(bundleToInternalBundle(bundle))
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  getParentBundles(bundle: IBundle): Array<IBundle> {
    return this.#graph
      .getParentBundles(bundleToInternalBundle(bundle))
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  resolveSymbol(
    asset: IAsset,
    symbol: Symbol,
    boundary: ?IBundle,
  ): SymbolResolution {
    let res = this.#graph.resolveSymbol(
      assetToAssetValue(asset),
      symbol,
      boundary ? bundleToInternalBundle(boundary) : null,
    );
    return {
      asset: assetFromValue(res.asset, this.#options),
      exportSymbol: res.exportSymbol,
      symbol: res.symbol,
    };
  }

  getExportedSymbols(asset: IAsset): Array<SymbolResolution> {
    let res = this.#graph.getExportedSymbols(assetToAssetValue(asset));
    return res.map(e => ({
      asset: assetFromValue(e.asset, this.#options),
      exportSymbol: e.exportSymbol,
      symbol: e.symbol,
    }));
  }

  traverseBundles<TContext>(
    visit: GraphVisitor<IBundle, TContext>,
    startBundle: ?IBundle,
  ): ?TContext {
    return this.#graph.traverseBundles(
      mapVisitor(
        bundle => new Bundle(bundle, this.#graph, this.#options),
        visit,
      ),
      startBundle == null ? undefined : bundleToInternalBundle(startBundle),
    );
  }

  findBundlesWithAsset(asset: IAsset): Array<IBundle> {
    return this.#graph
      .findBundlesWithAsset(assetToAssetValue(asset))
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  findBundlesWithDependency(dependency: IDependency): Array<IBundle> {
    return this.#graph
      .findBundlesWithDependency(dependencyToInternalDependency(dependency))
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }
}
