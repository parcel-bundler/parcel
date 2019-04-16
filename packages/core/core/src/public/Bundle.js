// @flow strict-local
// flowlint unsafe-getters-setters:off

import type {Bundle as InternalBundle} from '../types';
import type {
  Asset,
  Bundle as IBundle,
  BundleGroup,
  Dependency,
  Environment,
  FilePath,
  GraphTraversalCallback,
  MutableBundle as IMutableBundle,
  FulfilledBundle as IFulfilledBundle,
  Stats,
  Target
} from '@parcel/types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {getBundleGroupId} from './utils';

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

  get stats(): Stats {
    return this.#bundle.stats;
  }

  getBundleGroups(): Array<BundleGroup> {
    return this.#bundle.assetGraph
      .findNodes(node => node.type === 'bundle_group')
      .map(node => {
        invariant(node.type === 'bundle_group');
        return node.value;
      });
  }

  getBundlesInGroup(bundleGroup: BundleGroup): Array<IBundle> {
    let bundleGroupNode = this.#bundle.assetGraph.getNode(
      getBundleGroupId(bundleGroup)
    );

    if (bundleGroupNode == null) {
      throw new Error(`Bundle group not found in bundle ${this.id}`);
    }

    return this.#bundle.assetGraph
      .getNodesConnectedFrom(bundleGroupNode)
      .map(node => {
        invariant(node.type === 'bundle');
        return node.value;
      })
      .sort(
        bundle => (bundle.assetGraph.hasNode(bundleGroup.entryAssetId) ? 1 : -1)
      )
      .map(bundle => new Bundle(bundle));
  }

  getDependencies(asset: Asset): Array<Dependency> {
    return this.#bundle.assetGraph.getDependencies(asset);
  }

  getDependencyResolution(dependency: Dependency): ?Asset {
    return this.#bundle.assetGraph.getDependencyResolution(dependency);
  }

  getEntryAssets(): Array<Asset> {
    return this.#bundle.assetGraph.getEntryAssets();
  }

  getTotalSize(asset?: Asset): number {
    return this.#bundle.assetGraph.getTotalSize(asset);
  }

  traverseAssets<TContext>(
    visit: GraphTraversalCallback<Asset, TContext>
  ): ?TContext {
    return this.#bundle.assetGraph.traverse((node, ...args) => {
      if (node.type === 'asset') {
        return visit(node.value, ...args);
      }
    });
  }
}

export class MutableBundle extends Bundle implements IMutableBundle {
  #bundle; // InternalBundle

  constructor(bundle: InternalBundle) {
    super(bundle);
    this.#bundle = bundle; // Repeating for flow
  }

  get filePath(): ?FilePath {
    return this.#bundle.filePath;
  }

  set filePath(filePath: ?FilePath): void {
    this.#bundle.filePath = filePath;
  }

  get isEntry(): ?boolean {
    return this.#bundle.isEntry;
  }

  set isEntry(isEntry?: ?boolean): void {
    this.#bundle.isEntry = isEntry;
  }

  get stats(): Stats {
    return this.#bundle.stats;
  }

  set stats(stats: Stats): void {
    this.#bundle.stats = stats;
  }

  removeAsset(asset: Asset): void {
    return this.#bundle.assetGraph.removeAsset(asset);
  }

  merge(bundle: IBundle): void {
    this.#bundle.assetGraph.merge(
      nullthrows(bundleToInternal.get(bundle)).assetGraph
    );
  }
}

export class FulfilledBundle extends Bundle implements IFulfilledBundle {
  #bundle; // InternalBundle

  constructor(bundle: InternalBundle) {
    super(bundle);
    this.#bundle = bundle; // Repeating for flow
  }

  get filePath(): FilePath {
    return nullthrows(this.#bundle.filePath);
  }
}
