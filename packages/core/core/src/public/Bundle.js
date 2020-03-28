// @flow strict-local
// flowlint unsafe-getters-setters:off

import type {Bundle as InternalBundle, ParcelOptions} from '../types';
import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleTraversable,
  Environment as IEnvironment,
  FilePath,
  NamedBundle as INamedBundle,
  Stats,
  Target as ITarget,
  GraphVisitor,
} from '@parcel/types';
import type BundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {DefaultWeakMap} from '@parcel/utils';

import {assetToAssetValue, assetFromValue} from './Asset';
import {mapVisitor} from '../Graph';
import Environment from './Environment';
import Dependency from './Dependency';
import Target from './Target';

const internalBundleToBundle: DefaultWeakMap<
  ParcelOptions,
  DefaultWeakMap<BundleGraph, WeakMap<InternalBundle, Bundle>>,
> = new DefaultWeakMap(() => new DefaultWeakMap(() => new WeakMap()));
const internalBundleToNamedBundle: DefaultWeakMap<
  ParcelOptions,
  DefaultWeakMap<BundleGraph, WeakMap<InternalBundle, NamedBundle>>,
> = new DefaultWeakMap(() => new DefaultWeakMap(() => new WeakMap()));

// Friendly access for other modules within this package that need access
// to the internal bundle.
const _bundleToInternalBundle: WeakMap<IBundle, InternalBundle> = new WeakMap();
export function bundleToInternalBundle(bundle: IBundle): InternalBundle {
  return nullthrows(_bundleToInternalBundle.get(bundle));
}
const _bundleToInternalBundleGraph: WeakMap<
  IBundle,
  BundleGraph,
> = new WeakMap();
export function bundleToInternalBundleGraph(bundle: IBundle): BundleGraph {
  return nullthrows(_bundleToInternalBundleGraph.get(bundle));
}

export class Bundle implements IBundle {
  #bundle; // InternalBundle
  #bundleGraph; // BundleGraph
  #options; // ParcelOptions

  constructor(
    bundle: InternalBundle,
    bundleGraph: BundleGraph,
    options: ParcelOptions,
  ) {
    let existingMap = internalBundleToBundle.get(options).get(bundleGraph);
    let existing = existingMap.get(bundle);
    if (existing != null) {
      return existing;
    }

    this.#bundle = bundle;
    this.#bundleGraph = bundleGraph;
    this.#options = options;

    _bundleToInternalBundle.set(this, bundle);
    _bundleToInternalBundleGraph.set(this, bundleGraph);
    existingMap.set(bundle, this);
  }

  get id(): string {
    return this.#bundle.id;
  }

  get hashReference(): string {
    return this.#bundle.hashReference;
  }

  get type(): string {
    return this.#bundle.type;
  }

  get env(): IEnvironment {
    return new Environment(this.#bundle.env);
  }

  get isEntry(): ?boolean {
    return this.#bundle.isEntry;
  }

  get isInline(): ?boolean {
    return this.#bundle.isInline;
  }

  get isSplittable(): ?boolean {
    return this.#bundle.isSplittable;
  }

  get target(): ITarget {
    return new Target(this.#bundle.target);
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
      assetToAssetValue(asset),
    );
  }

  getEntryAssets(): Array<IAsset> {
    return this.#bundle.entryAssetIds.map(id => {
      let assetNode = this.#bundleGraph._graph.getNode(id);
      invariant(assetNode != null && assetNode.type === 'asset');
      return assetFromValue(assetNode.value, this.#options);
    });
  }

  getMainEntry(): ?IAsset {
    // The main entry is the last one to execute
    return this.getEntryAssets().pop();
  }

  traverse<TContext>(
    visit: GraphVisitor<BundleTraversable, TContext>,
  ): ?TContext {
    return this.#bundleGraph.traverseBundle(
      this.#bundle,
      mapVisitor(node => {
        if (node.type === 'asset') {
          return {
            type: 'asset',
            value: assetFromValue(node.value, this.#options),
          };
        } else if (node.type === 'dependency') {
          return {type: 'dependency', value: new Dependency(node.value)};
        }
      }, visit),
    );
  }

  traverseAssets<TContext>(visit: GraphVisitor<IAsset, TContext>) {
    return this.#bundleGraph.traverseAssets(
      this.#bundle,
      mapVisitor(asset => assetFromValue(asset, this.#options), visit),
    );
  }
}

export class NamedBundle extends Bundle implements INamedBundle {
  #bundle; // InternalBundle
  #bundleGraph; // BundleGraph

  constructor(
    bundle: InternalBundle,
    bundleGraph: BundleGraph,
    options: ParcelOptions,
  ) {
    let existingMap = internalBundleToNamedBundle.get(options).get(bundleGraph);
    let existing = existingMap.get(bundle);
    if (existing != null) {
      return existing;
    }

    super(bundle, bundleGraph, options);
    this.#bundle = bundle; // Repeating for flow
    this.#bundleGraph = bundleGraph; // Repeating for flow
    existingMap.set(bundle, this);
  }

  get filePath(): FilePath {
    return nullthrows(this.#bundle.filePath);
  }

  get name(): string {
    return nullthrows(this.#bundle.name);
  }

  get displayName(): string {
    return nullthrows(this.#bundle.displayName);
  }
}
