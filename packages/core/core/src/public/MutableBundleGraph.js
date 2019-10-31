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
  Target
} from '@parcel/types';
import type {ParcelOptions} from '../types';

import invariant from 'assert';
import nullthrows from 'nullthrows';

import InternalBundleGraph from '../BundleGraph';
import {Bundle, bundleToInternalBundle} from './Bundle';
import {mapVisitor, ALL_EDGE_TYPES} from '../Graph';
import {assetFromValue, assetToInternalAsset} from './Asset';
import {getBundleGroupId} from '../utils';
import Dependency, {dependencyToInternalDependency} from './Dependency';
import {environmentToInternalEnvironment} from './Environment';
import {targetToInternalTarget} from './Target';

export default class MutableBundleGraph implements IMutableBundleGraph {
  #graph; // InternalBundleGraph
  #options; // ParcelOptions

  constructor(graph: InternalBundleGraph, options: ParcelOptions) {
    this.#graph = graph;
    this.#options = options;
  }

  addAssetGraphToBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.addAssetGraphToBundle(
      assetToInternalAsset(asset).value,
      bundleToInternalBundle(bundle)
    );
  }

  createBundleGroup(dependency: IDependency, target: Target): BundleGroup {
    let dependencyNode = this.#graph._graph.getNode(dependency.id);
    if (!dependencyNode) {
      throw new Error('Dependency not found');
    }

    let resolved = this.#graph.getDependencyResolution(
      dependencyToInternalDependency(dependency)
    );
    if (!resolved) {
      throw new Error('Dependency did not resolve to an asset');
    }

    let bundleGroup: BundleGroup = {
      target,
      entryAssetId: resolved.id
    };

    let bundleGroupNode = {
      id: getBundleGroupId(bundleGroup),
      type: 'bundle_group',
      value: bundleGroup
    };

    this.#graph._graph.addNode(bundleGroupNode);
    let assetNodes = this.#graph._graph.getNodesConnectedFrom(dependencyNode);
    this.#graph._graph.addEdge(dependencyNode.id, bundleGroupNode.id);
    this.#graph._graph.replaceNodesConnectedTo(bundleGroupNode, assetNodes);
    this.#graph._graph.removeEdge(dependencyNode.id, resolved.id);

    if (dependency.isEntry) {
      this.#graph._graph.addEdge(
        nullthrows(this.#graph._graph.getRootNode()).id,
        bundleGroupNode.id,
        'bundle'
      );
    } else {
      let inboundBundleNodes = this.#graph._graph.getNodesConnectedTo(
        dependencyNode,
        'contains'
      );
      for (let inboundBundleNode of inboundBundleNodes) {
        invariant(inboundBundleNode.type === 'bundle');
        this.#graph._graph.addEdge(
          inboundBundleNode.id,
          bundleGroupNode.id,
          'bundle'
        );
      }
    }

    return bundleGroup;
  }

  createBundle(opts: CreateBundleOpts): Bundle {
    let bundleId = 'bundle:' + (opts.id ?? nullthrows(opts.entryAsset?.id));
    let bundleNode = {
      type: 'bundle',
      id: bundleId,
      value: {
        id: bundleId,
        type: opts.type ?? nullthrows(opts.entryAsset).type,
        env: environmentToInternalEnvironment(
          opts.env ?? nullthrows(opts.entryAsset).env
        ),
        entryAssetIds: opts.entryAsset ? [opts.entryAsset.id] : [],
        filePath: null,
        isEntry: opts.isEntry,
        isInline: opts.isInline,
        target: targetToInternalTarget(opts.target),
        name: null,
        stats: {size: 0, time: 0}
      }
    };

    this.#graph._graph.addNode(bundleNode);

    if (opts.entryAsset) {
      this.#graph._graph.addEdge(bundleNode.id, opts.entryAsset.id);
    }
    return new Bundle(bundleNode.value, this.#graph, this.#options);
  }

  addBundleToBundleGroup(bundle: IBundle, bundleGroup: BundleGroup) {
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
      assetToInternalAsset(asset).value
    );
  }

  getDependencyAssets(dependency: IDependency): Array<IAsset> {
    return this.#graph
      .getDependencyAssets(dependencyToInternalDependency(dependency))
      .map(asset => assetFromValue(asset, this.#options));
  }

  getDependencyResolution(dependency: IDependency): ?IAsset {
    let resolved = this.#graph.getDependencyResolution(
      dependencyToInternalDependency(dependency)
    );

    if (resolved) {
      return assetFromValue(resolved, this.#options);
    }
  }

  traverse<TContext>(
    visit: GraphVisitor<BundlerBundleGraphTraversable, TContext>
  ): ?TContext {
    return this.#graph._graph.filteredTraverse(
      node => {
        if (node.type === 'asset') {
          return {
            type: 'asset',
            value: assetFromValue(node.value, this.#options)
          };
        } else if (node.type === 'dependency') {
          return {type: 'dependency', value: new Dependency(node.value)};
        }
      },
      visit,
      undefined, // start with root
      // $FlowFixMe
      ALL_EDGE_TYPES
    );
  }

  findBundlesWithAsset(asset: IAsset): Array<IBundle> {
    return this.#graph
      .findBundlesWithAsset(assetToInternalAsset(asset).value)
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    return this.#graph.getBundleGroupsContainingBundle(
      bundleToInternalBundle(bundle)
    );
  }

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<IBundle> {
    return this.#graph
      .getBundlesInBundleGroup(bundleGroup)
      .map(bundle => new Bundle(bundle, this.#graph, this.#options));
  }

  getTotalSize(asset: IAsset): number {
    return this.#graph.getTotalSize(assetToInternalAsset(asset).value);
  }

  isAssetInAncestorBundles(bundle: IBundle, asset: IAsset): boolean {
    return this.#graph.isAssetInAncestorBundles(
      bundleToInternalBundle(bundle),
      assetToInternalAsset(asset).value
    );
  }

  removeAssetGraphFromBundle(asset: IAsset, bundle: IBundle) {
    this.#graph.removeAssetGraphFromBundle(
      assetToInternalAsset(asset).value,
      bundleToInternalBundle(bundle)
    );
  }

  traverseBundles<TContext>(visit: GraphVisitor<IBundle, TContext>): ?TContext {
    return this.#graph.traverseBundles(
      mapVisitor(
        bundle => new Bundle(bundle, this.#graph, this.#options),
        visit
      )
    );
  }

  traverseContents<TContext>(
    visit: GraphVisitor<BundlerBundleGraphTraversable, TContext>
  ): ?TContext {
    return this.#graph.traverseContents(
      mapVisitor(
        node =>
          node.type === 'asset'
            ? {type: 'asset', value: assetFromValue(node.value, this.#options)}
            : {
                type: 'dependency',
                value: new Dependency(node.value)
              },
        visit
      )
    );
  }
}
