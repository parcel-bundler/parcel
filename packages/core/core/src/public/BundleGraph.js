// @flow strict-local
// flowlint unsafe-getters-setters:off

import type {
  AssetGraphNode,
  Bundle as InternalBundle,
  BundleNode,
  BundleGraphNode,
  BundleGroupNode,
  BundleReference as IBundleReference,
  BundleReferenceNode
} from '../types';

import type {
  Asset,
  Bundle as IBundle,
  BundleGraph as IBundleGraph,
  BundleGroup,
  GraphTraversalCallback,
  MutableBundle as IMutableBundle,
  MutableBundleGraph as IMutableBundleGraph
} from '@parcel/types';

import type Graph from '../Graph';
import type InternalBundleGraph from '../BundleGraph';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {assetToInternalAsset} from './Asset';
import {Bundle, MutableBundle, bundleToInternal} from './Bundle';
import {getBundleGroupId} from './utils';

class BaseBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    this.#graph = graph;
  }

  getBundleGroupsContainingBundle(bundle: IBundle): Array<BundleGroup> {
    let node = nullthrows(
      this.#graph.getNode(bundle.id),
      'Bundle graph must contain bundle'
    );

    return this.#graph.getNodesConnectedTo(node).map(node => {
      invariant(node.type === 'bundle_group');
      return node.value;
    });
  }

  getBundleGroupsReferencedByBundle(bundle: IBundle): Array<BundleGroup> {
    let node = nullthrows(
      this.#graph.getNode(bundle.id),
      'Bundle graph must contain bundle'
    );

    let groups = [];
    this.#graph.traverse((node, context, actions) => {
      if (node.type === 'bundle_group') {
        groups.push(node.value);
        actions.skipChildren();
      }
    }, node);
    return groups;
  }

  isAssetInAncestorBundle(bundle: IBundle, asset: Asset): boolean {
    let internalNode = this.#graph.getNode(bundle.id);
    invariant(internalNode != null && internalNode.type === 'bundle');
    return this.#graph.isAssetInAncestorBundle(
      internalNode.value,
      assetToInternalAsset(asset)
    );
  }
}

export class BundleGraph extends BaseBundleGraph implements IBundleGraph {
  #graph; // InternalBundleGraph

  constructor(graph: InternalBundleGraph) {
    super(graph);
    this.#graph = graph; // Repeating for flow
  }

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<IBundle> {
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

  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<IMutableBundle> {
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
    let bundleGroupId = getBundleGroupId(bundleGroup);
    let existingNode = this.#graph.getNode(bundleGroupId);

    // If a bundle group for this entry asset already exists, use that instead
    // of creating a new bundle group.
    // TODO: What about the bundle group's dependency?
    let node: BundleGroupNode;
    if (existingNode == null) {
      node = {
        id: bundleGroupId,
        type: 'bundle_group',
        value: bundleGroup
      };
    } else if (existingNode.type === 'bundle_group') {
      node = existingNode;
    } else {
      throw new Error('Existing node was not a bundle group');
    }

    // Add a connection from the dependency to the new bundle group in all bundles
    this.#graph.traverse(bundle => {
      if (bundle.type === 'bundle') {
        let depNode = bundle.value.assetGraph.getNode(
          bundleGroup.dependency.id
        );
        if (depNode) {
          // Merge the bundle graph's representation of this bundle group into
          // the bundle's asset graph. Connections may have been made if this
          // bundle group already existed.
          mergeBundleGraphIntoBundleAssetGraph(
            bundle.value.assetGraph,
            this.#graph.getSubGraph(node)
          );
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
        let bundleGroup = node.value;
        let depNode = assetGraph.getNode(bundleGroup.dependency.id);
        if (depNode && !assetGraph.hasNode(node.id)) {
          mergeBundleGraphIntoBundleAssetGraph(
            assetGraph,
            this.#graph.getSubGraph(node)
          );
          assetGraph.replaceNodesConnectedTo(depNode, [node]);
          this.#graph.addEdge({
            from: internalBundle.id,
            to: node.id
          });
        }
      }

      let referenceNode = bundleNodeToBundleReferenceNode(bundleNode);
      // Add a connection from the bundle group to the bundle in all bundles
      if (
        node.type === 'bundle' &&
        node.value.assetGraph.hasNode(bundleGroupId)
      ) {
        node.value.assetGraph.addNode(referenceNode);
        node.value.assetGraph.addEdge({
          from: bundleGroupId,
          to: referenceNode.id
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

function bundleNodeToBundleReferenceNode(
  bundleNode: BundleNode
): BundleReferenceNode {
  return {
    id: bundleNode.id,
    type: 'bundle_reference',
    value: new BundleReference(bundleNode.value)
  };
}

function mergeBundleGraphIntoBundleAssetGraph(
  bundleAssetGraph: Graph<AssetGraphNode>,
  bundleGraph: Graph<BundleGraphNode>
): void {
  for (let [, node] of bundleGraph.nodes) {
    if (node.type === 'bundle') {
      bundleAssetGraph.addNode(bundleNodeToBundleReferenceNode(node));
    } else {
      bundleAssetGraph.addNode(node);
    }
  }

  for (let edge of bundleGraph.edges) {
    bundleAssetGraph.addEdge(edge);
  }
}

class BundleReference implements IBundleReference {
  #bundle;

  constructor(bundle: InternalBundle) {
    this.#bundle = bundle;
  }

  get id() {
    return this.#bundle.id;
  }

  get type() {
    return this.#bundle.type;
  }

  get env() {
    return this.#bundle.env;
  }

  get isEntry() {
    return this.#bundle.isEntry;
  }

  get target() {
    return this.#bundle.target;
  }

  get filePath() {
    return this.#bundle.filePath;
  }

  get name() {
    return this.#bundle.name;
  }

  get stats() {
    return this.#bundle.stats;
  }
}
