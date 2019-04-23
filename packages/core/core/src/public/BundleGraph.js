// @flow strict-local

import type {BundleNode} from '../types';

import type {
  Asset,
  Bundle,
  BundleGraph as IBundleGraph,
  BundleGroup,
  GraphTraversalCallback,
  MutableBundle as IMutableBundle
} from '@parcel/types';

import type InternalBundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {MutableBundle, bundleToInternal} from './Bundle';
import {getBundleGroupId} from './utils';

export default class BundleGraph implements IBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    this.#graph = graph;
  }

  addBundleGroup(parentBundle: ?Bundle, bundleGroup: BundleGroup) {
    let node = {
      id: getBundleGroupId(bundleGroup),
      type: 'bundle_group',
      value: bundleGroup
    };

    // Add a connection from the dependency to the new bundle group in all bundles
    this.#graph.traverse(bundle => {
      if (bundle.type === 'bundle') {
        let depNode = bundle.value.assetGraph.getNode(
          bundleGroup.dependency.id
        );
        if (depNode) {
          bundle.value.assetGraph.replaceNodesConnectedTo(depNode, [node]);
        }
      }
    });

    this.#graph.addNode(node);
    this.#graph.addEdge({
      from: parentBundle ? parentBundle.id : 'root',
      to: node.id
    });
  }

  addBundle(bundleGroup: BundleGroup, bundle: Bundle) {
    let internalBundle = nullthrows(bundleToInternal.get(bundle));

    // Propagate target from bundle group to bundle
    if (bundleGroup.target && !internalBundle.target) {
      internalBundle.target = bundleGroup.target;
    }

    let bundleGroupId = getBundleGroupId(bundleGroup);
    let bundleNode: BundleNode = {
      id: bundle.id,
      type: 'bundle',
      value: internalBundle
    };

    this.#graph.addNode(bundleNode);
    this.#graph.addEdge({
      from: bundleGroupId,
      to: bundleNode.id
    });

    this.#graph.traverse(node => {
      // Replace dependencies in this bundle with bundle group references for
      // already created bundles in the bundle graph. This can happen when two
      // bundles point to the same dependency, which has an async import.
      if (node.type === 'bundle_group') {
        let {assetGraph} = internalBundle;
        let bundleGroup: BundleGroup = node.value;
        let depNode = assetGraph.getNode(bundleGroup.dependency.id);
        if (depNode && !assetGraph.hasNode(node.id)) {
          // $FlowFixMe Merging a graph of a subtype into a graph of the supertype
          assetGraph.merge(this.#graph.getSubGraph(node));
          assetGraph.replaceNodesConnectedTo(depNode, [node]);
          this.#graph.addEdge({from: internalBundle.id, to: node.id});
        }
      }

      // Add a connection from the bundle group to the bundle in all bundles
      if (
        node.type === 'bundle' &&
        node.value.assetGraph.hasNode(bundleGroupId)
      ) {
        node.value.assetGraph.addNode(bundleNode);
        node.value.assetGraph.addEdge({
          from: bundleGroupId,
          to: bundleNode.id
        });
      }
    });
  }

  getBundles(bundleGroup: BundleGroup): Array<IMutableBundle> {
    let bundleGroupId = getBundleGroupId(bundleGroup);
    let node = this.#graph.getNode(bundleGroupId);
    if (!node) {
      return [];
    }

    return this.#graph.getNodesConnectedFrom(node).map(node => {
      invariant(node.type === 'bundle');
      return new MutableBundle(node.value);
    });
  }

  getBundleGroups(bundle: Bundle): Array<BundleGroup> {
    let node = this.#graph.getNode(bundle.id);
    if (!node) {
      return [];
    }

    return this.#graph.getNodesConnectedTo(node).map(node => {
      invariant(node.type === 'bundle_group');
      return node.value;
    });
  }

  isAssetInAncestorBundle(bundle: Bundle, asset: Asset): boolean {
    let node = this.#graph.getNode(bundle.id);
    if (node == null) {
      throw new Error('Bundle not found');
    }
    if (node.type !== 'bundle') {
      throw new Error('Not a bundle id');
    }
    return this.#graph.isAssetInAncestorBundle(node.value, asset);
  }

  findBundlesWithAsset(asset: Asset): Array<IMutableBundle> {
    return Array.from(this.#graph.nodes.values())
      .filter(
        node =>
          node.type === 'bundle' && node.value.assetGraph.hasNode(asset.id)
      )
      .map(node => {
        invariant(node.type === 'bundle');
        return new MutableBundle(node.value);
      });
  }

  traverseBundles<TContext>(
    visit: GraphTraversalCallback<IMutableBundle, TContext>
  ): ?TContext {
    this.#graph.traverseBundles((bundle, ...args) => {
      visit(new MutableBundle(bundle), ...args);
    });
  }
}
