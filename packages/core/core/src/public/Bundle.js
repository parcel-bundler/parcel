// @flow strict-local
// flowlint unsafe-getters-setters:off

import type {Bundle as InternalBundle} from '../types';
import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleTraversable,
  Dependency,
  Environment,
  FilePath,
  NamedBundle as INamedBundle,
  Stats,
  Target,
  Symbol,
  GraphVisitor
} from '@parcel/types';
import type BundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {mapVisitor} from '../Graph';

import {Asset, assetToInternalAsset} from './Asset';
import {assetGraphVisitorToInternal} from './utils';

// Friendly access for other modules within this package that need access
// to the internal bundle.
export const bundleToInternal: WeakMap<IBundle, InternalBundle> = new WeakMap();

export class Bundle implements IBundle {
  #bundle; // InternalBundle
  #bundleGraph; // BundleGraph

  constructor(bundle: InternalBundle, bundleGraph: BundleGraph) {
    this.#bundle = bundle;
    this.#bundleGraph = bundleGraph;
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

  get target(): Target {
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

  hasAsset(asset: IAsset): boolean {
    return this.#bundleGraph.bundleHasAsset(
      this.#bundle,
      assetToInternalAsset(asset)
    );
  }

  getDependencies(asset: IAsset): Array<Dependency> {
    return this.#bundleGraph.getDependencies(assetToInternalAsset(asset));
  }

  getDependencyResolution(dependency: Dependency): ?Asset {
    let resolution = this.#bundleGraph.getDependencyResolution(dependency);

    if (resolution) {
      return new Asset(resolution);
    }
  }

  getEntryAssets(): Array<IAsset> {
    if (this.#bundle.entryAssetId == null) {
      return [];
    }

    let assetNode = this.#bundleGraph._graph.getNode(this.#bundle.entryAssetId);
    invariant(assetNode != null && assetNode.type === 'asset');
    return [new Asset(assetNode.value)];
  }

  traverse<TContext>(
    visit: GraphVisitor<BundleTraversable, TContext>
  ): ?TContext {
    return this.#bundleGraph.traverseBundle(
      this.#bundle,
      mapVisitor(node => {
        if (node.type === 'asset') {
          return {type: 'asset', value: new Asset(node.value)};
        } else if (node.type === 'dependency') {
          return {type: 'dependency', value: node.value};
        }
      }, visit)
    );
  }

  traverseAssets<TContext>(visit: GraphVisitor<IAsset, TContext>) {
    return this.#bundleGraph.traverseAssets(
      this.#bundle,
      assetGraphVisitorToInternal(visit)
    );
  }

  resolveSymbol(asset: IAsset, symbol: Symbol) {
    return this.#bundleGraph.resolveSymbol(assetToInternalAsset(asset), symbol);
  }

  hasChildBundles() {
    return this.#bundleGraph.hasChildBundles(this.#bundle);
  }

  getHash() {
    return this.#bundleGraph.getHash(this.#bundle);
  }
}

export class NamedBundle extends Bundle implements INamedBundle {
  #bundle; // InternalBundle
  #bundleGraph; // BundleGraph

  constructor(bundle: InternalBundle, bundleGraph: BundleGraph) {
    super(bundle, bundleGraph);
    this.#bundle = bundle; // Repeating for flow
    this.#bundleGraph = bundleGraph; // Repeating for flow
  }

  get filePath(): FilePath {
    return nullthrows(this.#bundle.filePath);
  }

  get name(): string {
    return nullthrows(this.#bundle.name);
  }
}
