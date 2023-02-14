// @flow strict-local

import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleGroup as IBundleGroup,
  CreateBundleOpts,
  Dependency as IDependency,
  MutableBundleGraph as IMutableBundleGraph,
  Target,
} from '@parcel/types';
import type {ParcelOptions, BundleGroup as InternalBundleGroup} from '../types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import BundleGraph from './BundleGraph';
import InternalBundleGraph, {bundleGraphEdgeTypes} from '../BundleGraph';
import {Bundle, bundleToInternalBundle} from './Bundle';
import {assetFromValue, assetToAssetValue} from './Asset';
import {getBundleGroupId} from '../utils';
import Dependency, {dependencyToInternalDependency} from './Dependency';
import {environmentToInternalEnvironment} from './Environment';
import {targetToInternalTarget} from './Target';
import BundleGroup, {bundleGroupToInternalBundleGroup} from './BundleGroup';

export default class MutableBundleGraph
  extends BundleGraph<IBundle>
  implements IMutableBundleGraph
{
  #graph /*: InternalBundleGraph */;
  #options /*: ParcelOptions */;
  #bundlePublicIds /*: Set<string> */ = new Set<string>();

  constructor(graph: InternalBundleGraph, options: ParcelOptions) {
    super(graph, Bundle.get.bind(Bundle), options);
    this.#graph = graph;
    this.#options = options;
  }

  addAssetToBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.addAssetToBundle(
      assetToAssetValue(asset),
      bundleToInternalBundle(bundle),
    );
  }

  addAssetGraphToBundle(
    asset: IAsset,
    bundle: IBundle,
    shouldSkipDependency?: IDependency => boolean,
  ) {
    this.#graph.addAssetGraphToBundle(
      assetToAssetValue(asset),
      bundleToInternalBundle(bundle),
      shouldSkipDependency
        ? d => shouldSkipDependency(new Dependency(d, this.#options))
        : undefined,
    );
  }

  addEntryToBundle(
    asset: IAsset,
    bundle: IBundle,
    shouldSkipDependency?: IDependency => boolean,
  ) {
    this.#graph.addEntryToBundle(
      assetToAssetValue(asset),
      bundleToInternalBundle(bundle),
      shouldSkipDependency
        ? d => shouldSkipDependency(new Dependency(d, this.#options))
        : undefined,
    );
  }

  createBundleGroup(dependency: IDependency, target: Target): IBundleGroup {
    let dependencyNode = this.#graph._graph.getNodeByContentKey(dependency.id);
    if (!dependencyNode) {
      throw new Error('Dependency not found');
    }

    invariant(dependencyNode.type === 'dependency');

    let resolved = this.#graph.getResolvedAsset(
      dependencyToInternalDependency(dependency),
    );
    if (!resolved) {
      throw new Error(
        'Dependency did not resolve to an asset ' + dependency.id,
      );
    }

    let bundleGroup: InternalBundleGroup = {
      target: targetToInternalTarget(target),
      entryAssetId: resolved.id,
    };

    let bundleGroupKey = getBundleGroupId(bundleGroup);
    let bundleGroupNodeId = this.#graph._graph.hasContentKey(bundleGroupKey)
      ? this.#graph._graph.getNodeIdByContentKey(bundleGroupKey)
      : this.#graph._graph.addNodeByContentKey(bundleGroupKey, {
          id: bundleGroupKey,
          type: 'bundle_group',
          value: bundleGroup,
        });

    let dependencyNodeId = this.#graph._graph.getNodeIdByContentKey(
      dependencyNode.id,
    );
    let resolvedNodeId = this.#graph._graph.getNodeIdByContentKey(resolved.id);
    let assetNodes =
      this.#graph._graph.getNodeIdsConnectedFrom(dependencyNodeId);
    this.#graph._graph.addEdge(dependencyNodeId, bundleGroupNodeId);
    this.#graph._graph.replaceNodeIdsConnectedTo(bundleGroupNodeId, assetNodes);
    this.#graph._graph.addEdge(
      dependencyNodeId,
      resolvedNodeId,
      bundleGraphEdgeTypes.references,
    );
    this.#graph._graph.removeEdge(dependencyNodeId, resolvedNodeId);

    if (dependency.isEntry) {
      this.#graph._graph.addEdge(
        nullthrows(this.#graph._graph.rootNodeId),
        bundleGroupNodeId,
        bundleGraphEdgeTypes.bundle,
      );
    } else {
      let inboundBundleNodeIds = this.#graph._graph.getNodeIdsConnectedTo(
        dependencyNodeId,
        bundleGraphEdgeTypes.contains,
      );
      for (let inboundBundleNodeId of inboundBundleNodeIds) {
        invariant(
          this.#graph._graph.getNode(inboundBundleNodeId)?.type === 'bundle',
        );
        this.#graph._graph.addEdge(
          inboundBundleNodeId,
          bundleGroupNodeId,
          bundleGraphEdgeTypes.bundle,
        );
      }
    }

    return new BundleGroup(bundleGroup, this.#options);
  }

  removeBundleGroup(bundleGroup: IBundleGroup): void {
    this.#graph.removeBundleGroup(
      bundleGroupToInternalBundleGroup(bundleGroup),
    );
  }

  internalizeAsyncDependency(bundle: IBundle, dependency: IDependency): void {
    this.#graph.internalizeAsyncDependency(
      bundleToInternalBundle(bundle),
      dependencyToInternalDependency(dependency),
    );
  }

  createBundle(opts: CreateBundleOpts): Bundle {
    let internalOpts = opts.entryAsset
      ? {
          ...opts,
          entryAsset: assetToAssetValue(opts.entryAsset),
          target: targetToInternalTarget(opts.target),
          shouldContentHash: this.#options.shouldContentHash,
          env: environmentToInternalEnvironment(opts.entryAsset.env),
        }
      : {
          ...opts,
          env: environmentToInternalEnvironment(opts.env),
          shouldContentHash: this.#options.shouldContentHash,
          target: targetToInternalTarget(opts.target),
        };

    let internalBundle = this.#graph.createBundle(internalOpts);

    return Bundle.get(internalBundle, this.#graph, this.#options);
  }

  addBundleToBundleGroup(bundle: IBundle, bundleGroup: IBundleGroup) {
    this.#graph.addBundleToBundleGroup(
      bundleToInternalBundle(bundle),
      bundleGroupToInternalBundleGroup(bundleGroup),
    );
  }

  createAssetReference(
    dependency: IDependency,
    asset: IAsset,
    bundle: IBundle,
  ): void {
    return this.#graph.createAssetReference(
      dependencyToInternalDependency(dependency),
      assetToAssetValue(asset),
      bundleToInternalBundle(bundle),
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

  getBundleGroupsContainingBundle(bundle: IBundle): Array<IBundleGroup> {
    return this.#graph
      .getBundleGroupsContainingBundle(bundleToInternalBundle(bundle))
      .map(bundleGroup => new BundleGroup(bundleGroup, this.#options));
  }

  getParentBundlesOfBundleGroup(bundleGroup: IBundleGroup): Array<IBundle> {
    return this.#graph
      .getParentBundlesOfBundleGroup(
        bundleGroupToInternalBundleGroup(bundleGroup),
      )
      .map(bundle => Bundle.get(bundle, this.#graph, this.#options));
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
}
