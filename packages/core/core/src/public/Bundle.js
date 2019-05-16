// @flow strict-local
// flowlint unsafe-getters-setters:off

import type {Bundle as InternalBundle, AssetGraphNode} from '../types';
import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleTraversable,
  Dependency,
  Environment,
  FilePath,
  MutableBundle as IMutableBundle,
  NamedBundle as INamedBundle,
  Stats,
  Target,
  Symbol,
  GraphVisitor
} from '@parcel/types';

import nullthrows from 'nullthrows';

import {Asset, assetToInternalAsset} from './Asset';
import {getInternalAsset, assetGraphVisitorToInternal} from './utils';

// Friendly access for other modules within this package that need access
// to the internal bundle.
export const bundleToInternal: WeakMap<IBundle, InternalBundle> = new WeakMap();

export class Bundle implements IBundle {
  #bundle; // InternalBundle

  constructor(bundle: InternalBundle) {
    this.#bundle = bundle;
    bundleToInternal.set(this, bundle);
  }

  get id(): string {
    return this.#bundle.id;
  }

  get type(): string {
    return this.#bundle.type;
  }

  get env(): Environment {
    return this.#bundle.env;
  }

  get isEntry(): ?boolean {
    return this.#bundle.isEntry;
  }

  get target(): ?Target {
    return this.#bundle.target;
  }

  get filePath(): ?FilePath {
    return this.#bundle.filePath;
  }

  get name(): ?string {
    return this.#bundle.name;
  }

  get stats(): Stats {
    return this.#bundle.stats;
  }

  getDependencies(asset: IAsset): Array<Dependency> {
    return this.#bundle.assetGraph.getDependencies(
      getInternalAsset(this.#bundle.assetGraph, asset)
    );
  }

  getDependencyResolution(dependency: Dependency): ?Asset {
    let resolution = this.#bundle.assetGraph.getDependencyResolution(
      dependency
    );

    if (resolution) {
      return new Asset(resolution);
    }
  }

  getEntryAssets(): Array<IAsset> {
    return this.#bundle.assetGraph
      .getEntryAssets()
      .map(asset => new Asset(asset));
  }

  getTotalSize(asset?: IAsset): number {
    if (asset) {
      return this.#bundle.assetGraph.getTotalSize(
        getInternalAsset(this.#bundle.assetGraph, asset)
      );
    }

    return this.#bundle.assetGraph.getTotalSize();
  }

  traverse<TContext>(
    visit: GraphVisitor<BundleTraversable, TContext>
  ): ?TContext {
    return this.#bundle.assetGraph.filteredTraverse(node => {
      if (node.type === 'asset') {
        return {type: 'asset', value: node.value};
      } else if (node.type === 'asset_reference') {
        return {type: 'asset_reference', value: node.value};
      }
    }, visit);
  }

  traverseAssets<TContext>(visit: GraphVisitor<IAsset, TContext>) {
    return this.#bundle.assetGraph.traverseAssets(
      assetGraphVisitorToInternal(visit)
    );
  }

  traverseAncestors<TContext>(
    asset: IAsset,
    visit: GraphVisitor<AssetGraphNode, TContext>
  ) {
    let node = nullthrows(
      this.#bundle.assetGraph.getNode(asset.id),
      'Bundle does not contain asset'
    );
    return this.#bundle.assetGraph.traverseAncestors(node, visit);
  }

  resolveSymbol(asset: IAsset, symbol: Symbol) {
    return this.#bundle.assetGraph.resolveSymbol(
      assetToInternalAsset(asset),
      symbol
    );
  }

  hasChildBundles() {
    let result = false;
    this.#bundle.assetGraph.traverse((node, ctx, actions) => {
      if (node.type === 'bundle_reference') {
        result = true;
        actions.stop();
      }
    });

    return result;
  }
}

export class MutableBundle extends Bundle implements IMutableBundle {
  #bundle; // InternalBundle

  constructor(bundle: InternalBundle) {
    super(bundle);
    this.#bundle = bundle; // Repeating for flow
  }

  get isEntry(): ?boolean {
    return this.#bundle.isEntry;
  }

  set isEntry(isEntry?: ?boolean): void {
    this.#bundle.isEntry = isEntry;
  }

  removeAsset(asset: IAsset): void {
    this.#bundle.assetGraph.removeAsset(
      getInternalAsset(this.#bundle.assetGraph, asset)
    );
  }

  merge(bundle: IBundle): void {
    // $FlowFixMe accessing another bundle's property is fine
    let otherBundle: InternalBundle = bundle.#bundle;
    this.#bundle.assetGraph.merge(otherBundle.assetGraph);
  }
}

export class NamedBundle extends Bundle implements INamedBundle {
  #bundle; // InternalBundle

  constructor(bundle: InternalBundle) {
    super(bundle);
    this.#bundle = bundle; // Repeating for flow
  }

  get filePath(): FilePath {
    return nullthrows(this.#bundle.filePath);
  }

  get name(): string {
    return nullthrows(this.#bundle.name);
  }
}
