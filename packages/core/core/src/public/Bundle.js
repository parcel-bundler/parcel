// @flow strict-local
// flowlint unsafe-getters-setters:off

import type {Bundle as InternalBundle} from '../types';
import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleTraversable,
  Environment,
  FilePath,
  NamedBundle as INamedBundle,
  Stats,
  Target,
  GraphVisitor
} from '@parcel/types';
import type BundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';

import {Asset, assetToInternalAsset} from './Asset';
import {mapVisitor} from '../Graph';

// Friendly access for other modules within this package that need access
// to the internal bundle.
const _bundleToInternalBundle: WeakMap<IBundle, InternalBundle> = new WeakMap();
export function bundleToInternalBundle(bundle: IBundle): InternalBundle {
  return nullthrows(_bundleToInternalBundle.get(bundle));
}

export class Bundle implements IBundle {
  #bundle; // InternalBundle
  #bundleGraph; // BundleGraph

  constructor(bundle: InternalBundle, bundleGraph: BundleGraph) {
    this.#bundle = bundle;
    this.#bundleGraph = bundleGraph;
    _bundleToInternalBundle.set(this, bundle);
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
      mapVisitor(asset => new Asset(asset), visit)
    );
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
