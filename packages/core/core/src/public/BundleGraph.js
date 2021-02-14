// @flow strict-local

import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleGraph as IBundleGraph,
  BundleGroup,
  Dependency as IDependency,
  ExportSymbolResolution,
  GraphVisitor,
  Symbol,
  SymbolResolution,
} from '@parcel/types';
import type {Bundle as InternalBundle, ParcelOptions} from '../types';
import type InternalBundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';

import {assetFromValue, assetToAssetValue, Asset} from './Asset';
import {bundleToInternalBundle} from './Bundle';
import Dependency, {dependencyToInternalDependency} from './Dependency';
import {mapVisitor} from '../Graph';

// Friendly access for other modules within this package that need access
// to the internal bundle.
const _bundleGraphToInternalBundleGraph: WeakMap<
  IBundleGraph<IBundle>,
  InternalBundleGraph,
> = new WeakMap();
export function bundleGraphToInternalBundleGraph(
  bundleGraph: IBundleGraph<IBundle>,
): InternalBundleGraph {
  return nullthrows(_bundleGraphToInternalBundleGraph.get(bundleGraph));
}

type BundleFactory<TBundle: IBundle> = (
  InternalBundle,
  InternalBundleGraph,
  ParcelOptions,
) => TBundle;

export default class BundleGraph<TBundle: IBundle>
  implements IBundleGraph<TBundle> {
  #graph: InternalBundleGraph;
  #options: ParcelOptions;
  // This is invoked as `this.#createBundle.call(null, ...)` below, as private
  // properties aren't currently callable in Flow:
  // https://github.com/parcel-bundler/parcel/pull/4591#discussion_r422661115
  // https://github.com/facebook/flow/issues/7877
  #createBundle: BundleFactory<TBundle>;

  constructor(
    graph: InternalBundleGraph,
    createBundle: BundleFactory<TBundle>,
    options: ParcelOptions,
  ) {
    this.#graph = graph;
    this.#options = options;
    this.#createBundle = createBundle;
    // $FlowFixMe
    _bundleGraphToInternalBundleGraph.set(this, graph);
  }

  getAssetById(id: string): Asset {
    return assetFromValue(this.#graph.getAssetById(id), this.#options);
  }

  getAssetPublicId(asset: IAsset): string {
    return this.#graph.getAssetPublicId(assetToAssetValue(asset));
  }

  isDependencySkipped(dep: IDependency): boolean {
    return this.#graph.isDependencySkipped(dependencyToInternalDependency(dep));
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

  getAssetWithDependency(dep: IDependency): ?IAsset {
    let asset = this.#graph.getAssetWithDependency(
      dependencyToInternalDependency(dep),
    );
    if (asset) {
      return assetFromValue(asset, this.#options);
    }
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this.#graph.getBundleGroupsContainingBundle(
      bundleToInternalBundle(bundle),
    );
  }

  getReferencedBundles(
    bundle: IBundle,
    opts?: {|recursive: boolean|},
  ): Array<TBundle> {
    return this.#graph
      .getReferencedBundles(bundleToInternalBundle(bundle), opts)
      .map(bundle =>
        this.#createBundle.call(null, bundle, this.#graph, this.#options),
      );
  }

  getRequiredBundlesForBundle(bundle: IBundle): Array<TBundle> {
    return this.#graph
      .getReferencedBundles(bundleToInternalBundle(bundle))
      .map(bundle =>
        this.#createBundle.call(null, bundle, this.#graph, this.#options),
      );
  }

  resolveAsyncDependency(
    dependency: IDependency,
    bundle: ?IBundle,
  ): ?(
    | {|type: 'bundle_group', value: BundleGroup|}
    | {|type: 'asset', value: IAsset|}
  ) {
    let resolved = this.#graph.resolveAsyncDependency(
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

  getReferencedBundle(dependency: IDependency, bundle: IBundle): ?TBundle {
    let result = this.#graph.getReferencedBundle(
      dependencyToInternalDependency(dependency),
      bundleToInternalBundle(bundle),
    );

    if (result != null) {
      return this.#createBundle.call(null, result, this.#graph, this.#options);
    }
  }

  getDependencies(asset: IAsset): Array<IDependency> {
    return this.#graph
      .getDependencies(assetToAssetValue(asset))
      .map(dep => new Dependency(dep));
  }

  isAssetReachableFromBundle(asset: IAsset, bundle: IBundle): boolean {
    return this.#graph.isAssetReachableFromBundle(
      assetToAssetValue(asset),
      bundleToInternalBundle(bundle),
    );
  }

  findReachableBundleWithAsset(bundle: IBundle, asset: IAsset): ?TBundle {
    let result = this.#graph.findReachableBundleWithAsset(
      bundleToInternalBundle(bundle),
      assetToAssetValue(asset),
    );

    if (result != null) {
      return this.#createBundle.call(null, result, this.#graph, this.#options);
    }

    return null;
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

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<TBundle> {
    return this.#graph
      .getBundlesInBundleGroup(bundleGroup)
      .map(bundle =>
        this.#createBundle.call(null, bundle, this.#graph, this.#options),
      );
  }

  getBundles(): Array<TBundle> {
    return this.#graph
      .getBundles()
      .map(bundle =>
        this.#createBundle.call(null, bundle, this.#graph, this.#options),
      );
  }

  isEntryBundleGroup(bundleGroup: BundleGroup): boolean {
    return this.#graph.isEntryBundleGroup(bundleGroup);
  }

  getChildBundles(bundle: IBundle): Array<TBundle> {
    return this.#graph
      .getChildBundles(bundleToInternalBundle(bundle))
      .map(bundle =>
        this.#createBundle.call(null, bundle, this.#graph, this.#options),
      );
  }

  getParentBundles(bundle: IBundle): Array<TBundle> {
    return this.#graph
      .getParentBundles(bundleToInternalBundle(bundle))
      .map(bundle =>
        this.#createBundle.call(null, bundle, this.#graph, this.#options),
      );
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
      loc: res.loc,
    };
  }

  getExportedSymbols(
    asset: IAsset,
    boundary: ?IBundle,
  ): Array<ExportSymbolResolution> {
    let res = this.#graph.getExportedSymbols(
      assetToAssetValue(asset),
      boundary ? bundleToInternalBundle(boundary) : null,
    );
    return res.map(e => ({
      asset: assetFromValue(e.asset, this.#options),
      exportSymbol: e.exportSymbol,
      symbol: e.symbol,
      loc: e.loc,
      exportAs: e.exportAs,
    }));
  }

  traverseBundles<TContext>(
    visit: GraphVisitor<TBundle, TContext>,
    startBundle: ?IBundle,
  ): ?TContext {
    return this.#graph.traverseBundles(
      mapVisitor(
        bundle =>
          this.#createBundle.call(null, bundle, this.#graph, this.#options),
        visit,
      ),
      startBundle == null ? undefined : bundleToInternalBundle(startBundle),
    );
  }

  findBundlesWithAsset(asset: IAsset): Array<TBundle> {
    return this.#graph
      .findBundlesWithAsset(assetToAssetValue(asset))
      .map(bundle =>
        this.#createBundle.call(null, bundle, this.#graph, this.#options),
      );
  }

  findBundlesWithDependency(dependency: IDependency): Array<TBundle> {
    return this.#graph
      .findBundlesWithDependency(dependencyToInternalDependency(dependency))
      .map(bundle =>
        this.#createBundle.call(null, bundle, this.#graph, this.#options),
      );
  }

  getUsedSymbols(v: IAsset | IDependency): $ReadOnlySet<Symbol> {
    if (v instanceof Asset) {
      return this.#graph.getUsedSymbolsAsset(assetToAssetValue(v));
    } else {
      invariant(v instanceof Dependency);
      return this.#graph.getUsedSymbolsDependency(
        dependencyToInternalDependency(v),
      );
    }
  }
}
