// @flow strict-local

import type {
  Asset as IAsset,
  Bundle as IBundle,
  BundleGraph as IBundleGraph,
  BundleGroup,
  Dependency as IDependency,
  GraphTraversalCallback
} from '@parcel/types';
import type InternalBundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';

import {assetToInternalAsset, Asset} from './Asset';
import {Bundle, bundleToInternal} from './Bundle';
import {mapVisitor} from '../Graph';

export default class BundleGraph implements IBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    this.#graph = graph;
  }

  getDependencyResolution(dep: IDependency): ?Asset {
    let resolution = this.#graph.getDependencyResolution(dep);
    if (resolution) {
      return new Asset(resolution);
    }
  }

  getIncomingDependencies(asset: IAsset): Array<IDependency> {
    return this.#graph.getIncomingDependencies(assetToInternalAsset(asset));
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this.#graph.getBundleGroupsContainingBundle(
      nullthrows(bundleToInternal.get(bundle))
    );
  }

  getBundleGroupsReferencedByBundle(bundle: IBundle): Array<BundleGroup> {
    let node = nullthrows(
      this.#graph._graph.getNode(bundle.id),
      'Bundle graph must contain bundle'
    );

    let groups = [];
    this.#graph._graph.traverse((node, context, actions) => {
      if (node.type === 'bundle_group') {
        groups.push(node.value);
        actions.skipChildren();
      }
    }, node);
    return groups;
  }

  getDependencies(asset: IAsset): Array<IDependency> {
    return this.#graph.getDependencies(assetToInternalAsset(asset));
  }

  isAssetInAncestorBundles(bundle: IBundle, asset: IAsset): boolean {
    let internalNode = this.#graph._graph.getNode(bundle.id);
    invariant(internalNode != null && internalNode.type === 'bundle');
    return this.#graph.isAssetInAncestorBundles(
      internalNode.value,
      assetToInternalAsset(asset)
    );
  }

  isAssetReferenced(asset: IAsset): boolean {
    return this.#graph.isAssetReferenced(assetToInternalAsset(asset));
  }

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<IBundle> {
    return this.#graph
      .getBundlesInBundleGroup(bundleGroup)
      .map(bundle => new Bundle(bundle, this.#graph));
  }

  getBundles(): Array<IBundle> {
    return this.#graph
      .getBundles()
      .map(bundle => new Bundle(bundle, this.#graph));
  }

  traverseBundles<TContext>(
    visit: GraphTraversalCallback<IBundle, TContext>
  ): ?TContext {
    return this.#graph.traverseBundles(
      mapVisitor(bundle => new Bundle(bundle, this.#graph), visit)
    );
  }
}
