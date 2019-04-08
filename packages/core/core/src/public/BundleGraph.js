// @flow strict-local

import type {Bundle as InternalBundle, BundleNode} from '../types';

import type {
  Asset,
  Bundle as IBundle,
  BundleGraph as IBundleGraph,
  BundleGroup,
  GraphTraversalCallback,
  MutableBundle as IMutableBundle,
  MutableBundleGraph as IMutableBundleGraph
} from '@parcel/types';

import type InternalBundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {Bundle, MutableBundle, bundleToInternal} from './Bundle';
import {getBundleGroupId} from './utils';

class BaseBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    this.#graph = graph;
  }

  getBundleGroups(bundle: IBundle): Array<BundleGroup> {
    let node = this.#graph.getNode(bundle.id);
    if (!node) {
      return [];
    }

    return this.#graph.getNodesConnectedTo(node).map(node => {
      invariant(node.type === 'bundle_group');
      return node.value;
    });
  }

  isAssetInAncestorBundle(bundle: IBundle, asset: Asset): boolean {
    let internalNode = this.#graph.getNode(bundle.id);
    invariant(internalNode != null && internalNode.type === 'bundle');
    return this.#graph.isAssetInAncestorBundle(internalNode.value, asset);
  }
}

export class BundleGraph extends BaseBundleGraph implements IBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    super(graph);
    this.#graph = graph; // Repeating for flow
  }

  getBundles(bundleGroup: BundleGroup): Array<IBundle> {
    return getBundles(this.#graph, bundleGroup).map(
      bundle => new Bundle(bundle)
    );
  }

  findBundlesWithAsset(asset: Asset): Array<IBundle> {
    return findBundlesWithAsset(this.#graph, asset).map(
      bundle => new Bundle(bundle)
    );
  }

  traverseBundles<TContext>(
    visit: GraphTraversalCallback<IBundle, TContext>
  ): ?TContext {
    this.#graph.traverseBundles((bundle, ...args) => {
      visit(new Bundle(bundle), ...args);
    });
  }
}

export class MutableBundleGraph extends BaseBundleGraph
  implements IMutableBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    super(graph);
    this.#graph = graph; // Repeating for flow
  }

  getBundles(bundleGroup: BundleGroup): Array<IMutableBundle> {
    return getBundles(this.#graph, bundleGroup).map(
      bundle => new MutableBundle(bundle)
    );
  }

  findBundlesWithAsset(asset: Asset): Array<IMutableBundle> {
    return findBundlesWithAsset(this.#graph, asset).map(
      bundle => new MutableBundle(bundle)
    );
  }

  traverseBundles<TContext>(
    visit: GraphTraversalCallback<IMutableBundle, TContext>
  ): ?TContext {
    this.#graph.traverseBundles((bundle, ...args) => {
      visit(new MutableBundle(bundle), ...args);
    });
  }

  addBundleGroup(parentBundle: ?IBundle, bundleGroup: BundleGroup) {
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

  addBundle(bundleGroup: BundleGroup, bundle: IBundle) {
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
    this.#graph.addEdge({from: bundleGroupId, to: bundleNode.id});

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
          this.#graph.addEdge({
            from: internalBundle.id,
            to: node.id
          });
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
}

function getBundles(
  graph: InternalBundleGraph,
  bundleGroup: BundleGroup
): Array<InternalBundle> {
  let bundleGroupId = getBundleGroupId(bundleGroup);
  let node = graph.getNode(bundleGroupId);
  if (!node) {
    return [];
  }

  return graph.getNodesConnectedFrom(node).map(node => {
    invariant(node.type === 'bundle');
    return node.value;
  });
}

function findBundlesWithAsset(
  graph: InternalBundleGraph,
  asset: Asset
): Array<InternalBundle> {
  return Array.from(graph.nodes.values())
    .filter(
      node => node.type === 'bundle' && node.value.assetGraph.hasNode(asset.id)
    )
    .map(node => {
      invariant(node.type === 'bundle');
      return node.value;
    });
}
