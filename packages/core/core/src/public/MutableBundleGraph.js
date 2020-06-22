// @flow strict-local

import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleGroup,
  CreateBundleOpts,
  Dependency as IDependency,
  GraphVisitor,
  MutableBundleGraph as IMutableBundleGraph,
  BundlerBundleGraphTraversable,
  Target,
} from '@parcel/types';
import type {ParcelOptions} from '../types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {md5FromString} from '@parcel/utils';
import BundleGraph from './BundleGraph';
import InternalBundleGraph from '../BundleGraph';
import {Bundle, bundleToInternalBundle} from './Bundle';
import {mapVisitor, ALL_EDGE_TYPES} from '../Graph';
import {assetFromValue, assetToAssetValue} from './Asset';
import {getBundleGroupId} from '../utils';
import Dependency, {dependencyToInternalDependency} from './Dependency';
import {environmentToInternalEnvironment} from './Environment';
import {targetToInternalTarget} from './Target';
import {HASH_REF_PREFIX} from '../constants';

export default class MutableBundleGraph extends BundleGraph<IBundle>
  implements IMutableBundleGraph {
  #graph; // InternalBundleGraph
  #options; // ParcelOptions

  constructor(graph: InternalBundleGraph, options: ParcelOptions) {
    super(
      graph,
      (bundle, bundleGraph, options) =>
        new Bundle(bundle, bundleGraph, options),
      options,
    );
    this.#graph = graph;
    this.#options = options;
  }

  addAssetGraphToBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.addAssetGraphToBundle(
      assetToAssetValue(asset),
      bundleToInternalBundle(bundle),
    );
  }

  createBundleGroup(dependency: IDependency, target: Target): BundleGroup {
    let dependencyNode = this.#graph._graph.getNode(dependency.id);
    if (!dependencyNode) {
      throw new Error('Dependency not found');
    }

    let resolved = this.#graph.getDependencyResolution(
      dependencyToInternalDependency(dependency),
    );
    if (!resolved) {
      throw new Error(
        'Dependency did not resolve to an asset ' + dependency.id,
      );
    }

    let bundleGroup: BundleGroup = {
      target,
      entryAssetId: resolved.id,
      bundleIds: [],
    };

    let bundleGroupNode = {
      id: getBundleGroupId(bundleGroup),
      type: 'bundle_group',
      value: bundleGroup,
    };

    this.#graph._graph.addNode(bundleGroupNode);
    let assetNodes = this.#graph._graph.getNodesConnectedFrom(dependencyNode);
    this.#graph._graph.addEdge(dependencyNode.id, bundleGroupNode.id);
    this.#graph._graph.replaceNodesConnectedTo(bundleGroupNode, assetNodes);
    this.#graph._graph.addEdge(dependencyNode.id, resolved.id, 'references');
    this.#graph._graph.removeEdge(dependencyNode.id, resolved.id);

    if (dependency.isEntry) {
      this.#graph._graph.addEdge(
        nullthrows(this.#graph._graph.getRootNode()).id,
        bundleGroupNode.id,
        'bundle',
      );
    } else {
      let inboundBundleNodes = this.#graph._graph.getNodesConnectedTo(
        dependencyNode,
        'contains',
      );
      for (let inboundBundleNode of inboundBundleNodes) {
        invariant(inboundBundleNode.type === 'bundle');
        this.#graph._graph.addEdge(
          inboundBundleNode.id,
          bundleGroupNode.id,
          'bundle',
        );
      }
    }

    return bundleGroup;
  }

  removeBundleGroup(bundleGroup: BundleGroup): void {
    for (let bundle of this.getBundlesInBundleGroup(bundleGroup)) {
      if (this.getBundleGroupsContainingBundle(bundle).length === 1) {
        this.#graph._graph.removeById(bundle.id);
      }
    }
    this.#graph._graph.removeById(getBundleGroupId(bundleGroup));
  }

  internalizeAsyncDependency(bundle: IBundle, dependency: IDependency): void {
    this.#graph.internalizeAsyncDependency(
      bundleToInternalBundle(bundle),
      dependencyToInternalDependency(dependency),
    );
  }

  createBundle(opts: CreateBundleOpts): Bundle {
    let entryAsset = opts.entryAsset
      ? assetToAssetValue(opts.entryAsset)
      : null;

    let target = targetToInternalTarget(opts.target);
    let bundleId = md5FromString(
      'bundle:' +
        (opts.uniqueKey ?? nullthrows(entryAsset?.id)) +
        target.distDir,
    );
    let bundleNode = {
      type: 'bundle',
      id: bundleId,
      value: {
        id: bundleId,
        hashReference: this.#options.contentHash
          ? HASH_REF_PREFIX + bundleId
          : bundleId.slice(0, 8),
        type: opts.type ?? nullthrows(entryAsset).type,
        env: opts.env
          ? environmentToInternalEnvironment(opts.env)
          : nullthrows(entryAsset).env,
        entryAssetIds: entryAsset ? [entryAsset.id] : [],
        pipeline: entryAsset ? entryAsset.pipeline : null,
        filePath: null,
        isEntry: opts.isEntry,
        isInline: opts.isInline,
        isSplittable: opts.isSplittable ?? entryAsset?.isSplittable,
        target,
        name: null,
        displayName: null,
        stats: {size: 0, time: 0},
      },
    };

    this.#graph._graph.addNode(bundleNode);

    if (opts.entryAsset) {
      this.#graph._graph.addEdge(bundleNode.id, opts.entryAsset.id);
    }
    return new Bundle(bundleNode.value, this.#graph, this.#options);
  }

  addBundleToBundleGroup(bundle: IBundle, bundleGroup: BundleGroup) {
    bundleGroup.bundleIds.push(bundle.id);
    let bundleGroupId = getBundleGroupId(bundleGroup);
    this.#graph._graph.addEdge(bundleGroupId, bundle.id);
    this.#graph._graph.addEdge(bundleGroupId, bundle.id, 'bundle');

    for (let entryAsset of bundle.getEntryAssets()) {
      if (this.#graph._graph.hasEdge(bundleGroupId, entryAsset.id)) {
        this.#graph._graph.removeEdge(bundleGroupId, entryAsset.id);
      }
    }
  }

  createAssetReference(dependency: IDependency, asset: IAsset): void {
    return this.#graph.createAssetReference(
      dependencyToInternalDependency(dependency),
      assetToAssetValue(asset),
    );
  }

  createBundleReference(from: IBundle, to: IBundle): void {
    return this.#graph.createBundleReference(
      bundleToInternalBundle(from),
      bundleToInternalBundle(to),
    );
  }

  getDependencyAssets(dependency: IDependency): Array<IAsset> {
    return this.#graph
      .getDependencyAssets(dependencyToInternalDependency(dependency))
      .map(asset => assetFromValue(asset, this.#options));
  }

  traverse<TContext>(
    visit: GraphVisitor<BundlerBundleGraphTraversable, TContext>,
  ): ?TContext {
    return this.#graph._graph.filteredTraverse(
      node => {
        if (node.type === 'asset') {
          return {
            type: 'asset',
            value: assetFromValue(node.value, this.#options),
          };
        } else if (node.type === 'dependency') {
          return {type: 'dependency', value: new Dependency(node.value)};
        }
      },
      visit,
      undefined, // start with root
      // $FlowFixMe
      ALL_EDGE_TYPES,
    );
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this.#graph.getBundleGroupsContainingBundle(
      bundleToInternalBundle(bundle),
    );
  }

  getParentBundlesOfBundleGroup(bundleGroup: BundleGroup): Array<IBundle> {
    return this.#graph
      .getParentBundlesOfBundleGroup(bundleGroup)
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  getTotalSize(asset: IAsset): number {
    return this.#graph.getTotalSize(assetToAssetValue(asset));
  }

  isAssetReachableFromBundle(asset: IAsset, bundle: IBundle): boolean {
    return this.#graph.isAssetReachableFromBundle(
      assetToAssetValue(asset),
      bundleToInternalBundle(bundle),
    );
  }

  removeAssetGraphFromBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.removeAssetGraphFromBundle(
      assetToAssetValue(asset),
      bundleToInternalBundle(bundle),
    );
  }

  traverseContents<TContext>(
    visit: GraphVisitor<BundlerBundleGraphTraversable, TContext>,
  ): ?TContext {
    return this.#graph.traverseContents(
      mapVisitor(
        node =>
          node.type === 'asset'
            ? {type: 'asset', value: assetFromValue(node.value, this.#options)}
            : {
                type: 'dependency',
                value: new Dependency(node.value),
              },
        visit,
      ),
    );
  }
}
