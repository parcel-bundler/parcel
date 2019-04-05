// @flow strict-local
// flowlint unsafe-getters-setters:off

import type {Bundle as InternalBundle} from '../types';
import type AssetGraph from '../AssetGraph';
import type {
  Asset,
  Bundle as IBundle,
  BundleGraph,
  BundleGroup,
  Dependency,
  Environment,
  FilePath,
  GraphTraversalCallback,
  MutableBundle as IMutableBundle,
  RuntimeBundle as IRuntimeBundle,
  Stats,
  Target,
  TransformerRequest
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

export class RuntimeBundle extends Bundle implements IRuntimeBundle {
  #bundle; // InternalBundle
  #bundleGraph; // BundleGraph
  #build; // TransformerRequest => Promise<AssetGraph>

  constructor({
    bundle,
    bundleGraph,
    build
  }: {
    bundle: InternalBundle,
    bundleGraph: BundleGraph,
    build: TransformerRequest => Promise<AssetGraph>
  }) {
    super(bundle);
    this.#bundle = bundle;
    this.#bundleGraph = bundleGraph;
    this.#build = build;
  }

  async addRuntimeAsset({
    filePath,
    code,
    bundleGroup
  }: {
    filePath: FilePath,
    code: string,
    bundleGroup?: BundleGroup
  }): Promise<void> {
    // Make this local to satisfy flow
    let build = this.#build;

    let graph: AssetGraph = await build({
      code,
      env: this.env,
      filePath
    });

    let entry = graph.getEntryAssets()[0];
    let subGraph = graph.getSubGraph(nullthrows(graph.getNode(entry.id)));

    // Exclude modules that are already included in an ancestor bundle
    subGraph.traverseAssets(asset => {
      if (this.#bundleGraph.isAssetInAncestorBundle(this, asset)) {
        subGraph.removeAsset(asset);
      }
    });

    // merge the transformed asset into the bundle's graph, and connect
    // the node to it. (Node is likely a BundleGroup or the bundle's root node)
    this.#bundle.assetGraph.merge(subGraph);

    this.#bundle.assetGraph.addEdge({
      from: bundleGroup
        ? getBundleGroupId(bundleGroup)
        : nullthrows(this.#bundle.assetGraph.getRootNode()).id,
      to: entry.id
    });
  }
}
