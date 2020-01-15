// @flow strict-local

import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleGraph as IBundleGraph,
  BundleGroup,
  Dependency as IDependency,
  GraphTraversalCallback,
  Symbol,
  SymbolResolution,
} from '@parcel/types';
import type {ParcelOptions} from '../types';
import type InternalBundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';

import {assetFromValue, assetToInternalAsset, Asset} from './Asset';
import {Bundle, bundleToInternalBundle} from './Bundle';
import Dependency, {dependencyToInternalDependency} from './Dependency';
import {mapVisitor} from '../Graph';

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

type SerializedBundleGraph = {|
  _graph: InternalBundleGraph,
  _options: ParcelOptions,
|};

export default class BundleGraph implements IBundleGraph {
  _graph: InternalBundleGraph;
  _options: ParcelOptions;

  constructor(graph: InternalBundleGraph, options: ParcelOptions) {
    this._graph = graph;
    this._options = options;
    _bundleGraphToInternalBundleGraph.set(this, graph);
  }

  static deserialize(opts: SerializedBundleGraph): BundleGraph {
    return new BundleGraph(opts._graph, opts._options);
  }

  getDependencyResolution(dep: IDependency): ?Asset {
    let resolution = this._graph.getDependencyResolution(
      dependencyToInternalDependency(dep),
    );
    if (resolution) {
      return assetFromValue(resolution, this._options);
    }
  }

  getIncomingDependencies(asset: IAsset): Array<IDependency> {
    return this._graph
      .getIncomingDependencies(assetToInternalAsset(asset).value)
      .map(dep => new Dependency(dep));
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this._graph.getBundleGroupsContainingBundle(
      bundleToInternalBundle(bundle),
    );
  }

  getSiblingBundles(bundle: IBundle): Array<IBundle> {
    return this._graph
      .getSiblingBundles(bundleToInternalBundle(bundle))
      .map(bundle => new Bundle(bundle, this._graph, this._options));
  }

  getBundleGroupsReferencedByBundle(
    bundle: IBundle,
  ): Array<{|
    bundleGroup: BundleGroup,
    dependency: IDependency,
  |}> {
    return this._graph
      .getBundleGroupsReferencedByBundle(bundleToInternalBundle(bundle))
      .map(({bundleGroup, dependency}) => ({
        bundleGroup,
        dependency: new Dependency(dependency),
      }));
  }

  getDependencies(asset: IAsset): Array<IDependency> {
    return this._graph
      .getDependencies(assetToInternalAsset(asset).value)
      .map(dep => new Dependency(dep));
  }

  isAssetInAncestorBundles(bundle: IBundle, asset: IAsset): boolean {
    let internalNode = this._graph._graph.getNode(bundle.id);
    invariant(internalNode != null && internalNode.type === 'bundle');
    return this._graph.isAssetInAncestorBundles(
      internalNode.value,
      assetToInternalAsset(asset).value,
    );
  }

  isAssetReferenced(asset: IAsset): boolean {
    return this._graph.isAssetReferenced(assetToInternalAsset(asset).value);
  }

  isAssetReferencedByAssetType(asset: IAsset, type: string): boolean {
    return this._graph.isAssetReferencedByAssetType(
      assetToInternalAsset(asset).value,
      type,
    );
  }

  hasParentBundleOfType(bundle: IBundle, type: string): boolean {
    return this._graph.hasParentBundleOfType(
      bundleToInternalBundle(bundle),
      type,
    );
  }

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<IBundle> {
    return this._graph
      .getBundlesInBundleGroup(bundleGroup)
      .map(bundle => new Bundle(bundle, this._graph, this._options));
  }

  getBundles(): Array<IBundle> {
    return this._graph
      .getBundles()
      .map(bundle => new Bundle(bundle, this._graph, this._options));
  }

  getChildBundles(bundle: IBundle): Array<IBundle> {
    return this._graph
      .getChildBundles(bundleToInternalBundle(bundle))
      .map(bundle => new Bundle(bundle, this._graph, this._options));
  }

  resolveSymbol(asset: IAsset, symbol: Symbol): SymbolResolution {
    let res = this._graph.resolveSymbol(
      assetToInternalAsset(asset).value,
      symbol,
    );
    return {
      asset: assetFromValue(res.asset, this._options),
      exportSymbol: res.exportSymbol,
      symbol: res.symbol,
    };
  }

  getExportedSymbols(asset: IAsset): Array<SymbolResolution> {
    let res = this._graph.getExportedSymbols(assetToInternalAsset(asset).value);
    return res.map(e => ({
      asset: assetFromValue(e.asset, this._options),
      exportSymbol: e.exportSymbol,
      symbol: e.symbol,
    }));
  }

  traverseBundles<TContext>(
    visit: GraphTraversalCallback<IBundle, TContext>,
  ): ?TContext {
    return this._graph.traverseBundles(
      mapVisitor(
        bundle => new Bundle(bundle, this._graph, this._options),
        visit,
      ),
    );
  }

  findBundlesWithAsset(asset: IAsset): Array<IBundle> {
    return this._graph
      .findBundlesWithAsset(assetToInternalAsset(asset).value)
      .map(bundle => new Bundle(bundle, this._graph, this._options));
  }
}
