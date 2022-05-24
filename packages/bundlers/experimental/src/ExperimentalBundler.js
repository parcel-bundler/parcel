// @flow strict-local

import type {
  Asset,
  Bundle as LegacyBundle,
  BundleBehavior,
  BundleGroup,
  Dependency,
  Environment,
  Config,
  MutableBundleGraph,
  PluginOptions,
  Target,
} from '@parcel/types';
import type {NodeId} from '@parcel/graph';
import type {SchemaEntity} from '@parcel/utils';
import {ContentGraph, Graph} from '@parcel/graph';

import invariant from 'assert';
import {ALL_EDGE_TYPES} from '@parcel/graph';
import {Bundler} from '@parcel/plugin';
import {
  setIntersect,
  setUnion,
  setEqual,
  validateSchema,
  DefaultMap,
} from '@parcel/utils';
import nullthrows from 'nullthrows';
import {encodeJSONKeyComponent} from '@parcel/diagnostic';

type BundlerConfig = {|
  http?: number,
  minBundles?: number,
  minBundleSize?: number,
  maxParallelRequests?: number,
|};

type ResolvedBundlerConfig = {|
  minBundles: number,
  minBundleSize: number,
  maxParallelRequests: number,
|};

// Default options by http version.
const HTTP_OPTIONS = {
  '1': {
    minBundles: 1,
    minBundleSize: 30000,
    maxParallelRequests: 6,
  },
  '2': {
    minBundles: 1,
    minBundleSize: 20000,
    maxParallelRequests: 25,
  },
};

type AssetId = string;
type BundleRoot = Asset;
export type Bundle = {|
  uniqueKey: ?string,
  assets: Set<Asset>,
  internalizedAssetIds: Array<AssetId>,
  bundleBehavior?: ?BundleBehavior,
  needsStableName: boolean,
  mainEntryAsset: ?Asset,
  size: number,
  sourceBundles: Array<NodeId>,
  target: Target,
  env: Environment,
  type: string,
|};

const dependencyPriorityEdges = {
  sync: 1,
  parallel: 2,
  lazy: 3,
};

type DependencyBundleGraph = ContentGraph<
  | {|
      value: Bundle,
      type: 'bundle',
    |}
  | {|
      value: Dependency,
      type: 'dependency',
    |},
  number,
>;
type IdealGraph = {|
  dependencyBundleGraph: DependencyBundleGraph,
  bundleGraph: Graph<Bundle | 'root'>,
  bundleGroupBundleIds: Set<NodeId>,
  assetReference: DefaultMap<Asset, Array<[Dependency, Bundle]>>,
  sharedToSourceBundleIds: Map<NodeId, Array<NodeId>>,
|};

export default (new Bundler({
  loadConfig({config, options}) {
    return loadBundlerConfig(config, options);
  },

  bundle({bundleGraph, config}) {
    decorateLegacyGraph(createIdealGraph(bundleGraph, config), bundleGraph);
  },
  optimize() {},
}): Bundler);

function decorateLegacyGraph(
  idealGraph: IdealGraph,
  bundleGraph: MutableBundleGraph,
): void {
  let idealBundleToLegacyBundle: Map<Bundle, LegacyBundle> = new Map();

  let {
    bundleGraph: idealBundleGraph,
    dependencyBundleGraph,
    bundleGroupBundleIds,
    sharedToSourceBundleIds,
  } = idealGraph;
  let entryBundleToBundleGroup: Map<NodeId, BundleGroup> = new Map();

  // Step Create Bundles: Create bundle groups, bundles, and shared bundles and add assets to them
  for (let [bundleNodeId, idealBundle] of idealBundleGraph.nodes) {
    if (idealBundle === 'root') continue;
    let entryAsset = idealBundle.mainEntryAsset;
    let bundleGroup;
    let bundle;

    if (bundleGroupBundleIds.has(bundleNodeId)) {
      let dependencies = dependencyBundleGraph
        .getNodeIdsConnectedTo(
          dependencyBundleGraph.getNodeIdByContentKey(String(bundleNodeId)),
          // $FlowFixMe[incompatible-call]
          ALL_EDGE_TYPES,
        )
        .map(nodeId => {
          let dependency = nullthrows(dependencyBundleGraph.getNode(nodeId));
          invariant(dependency.type === 'dependency');
          return dependency.value;
        });
      for (let dependency of dependencies) {
        bundleGroup = bundleGraph.createBundleGroup(
          dependency,
          idealBundle.target,
        );
      }
      invariant(bundleGroup);
      entryBundleToBundleGroup.set(bundleNodeId, bundleGroup);

      bundle = nullthrows(
        bundleGraph.createBundle({
          entryAsset,
          needsStableName: idealBundle.needsStableName,
          bundleBehavior: idealBundle.bundleBehavior,
          target: idealBundle.target,
        }),
      );

      bundleGraph.addBundleToBundleGroup(bundle, bundleGroup);
    } else if (idealBundle.sourceBundles.length > 0) {
      bundle = nullthrows(
        bundleGraph.createBundle({
          uniqueKey:
            [...idealBundle.assets].map(asset => asset.id).join(',') +
            idealBundle.sourceBundles.join(','),
          needsStableName: idealBundle.needsStableName,
          bundleBehavior: idealBundle.bundleBehavior,
          type: idealBundle.type,
          target: idealBundle.target,
          env: idealBundle.env,
        }),
      );
    } else if (idealBundle.uniqueKey != null) {
      bundle = nullthrows(
        bundleGraph.createBundle({
          uniqueKey: idealBundle.uniqueKey,
          needsStableName: idealBundle.needsStableName,
          bundleBehavior: idealBundle.bundleBehavior,
          type: idealBundle.type,
          target: idealBundle.target,
          env: idealBundle.env,
        }),
      );
    } else {
      invariant(entryAsset != null);
      bundle = nullthrows(
        bundleGraph.createBundle({
          entryAsset,
          needsStableName: idealBundle.needsStableName,
          bundleBehavior: idealBundle.bundleBehavior,
          target: idealBundle.target,
        }),
      );
    }

    idealBundleToLegacyBundle.set(idealBundle, bundle);

    for (let asset of idealBundle.assets) {
      bundleGraph.addAssetToBundle(asset, bundle);
    }
  }

  // Step Internalization: Internalize dependencies for bundles
  for (let [, idealBundle] of idealBundleGraph.nodes) {
    if (idealBundle === 'root') continue;
    let bundle = nullthrows(idealBundleToLegacyBundle.get(idealBundle));
    for (let internalized of idealBundle.internalizedAssetIds) {
      let incomingDeps = bundleGraph.getIncomingDependencies(
        bundleGraph.getAssetById(internalized),
      );
      for (let incomingDep of incomingDeps) {
        if (
          incomingDep.priority === 'lazy' &&
          incomingDep.specifierType !== 'url' &&
          bundle.hasDependency(incomingDep)
        ) {
          bundleGraph.internalizeAsyncDependency(bundle, incomingDep);
        }
      }
    }
  }

  // Step Add to BundleGroups: Add bundles to their bundle groups
  idealBundleGraph.traverse((nodeId, _, actions) => {
    let node = idealBundleGraph.getNode(nodeId);
    if (node === 'root') {
      return;
    }
    actions.skipChildren();

    let outboundNodeIds = idealBundleGraph.getNodeIdsConnectedFrom(nodeId);
    let entryBundle = nullthrows(idealBundleGraph.getNode(nodeId));
    invariant(entryBundle !== 'root');
    let legacyEntryBundle = nullthrows(
      idealBundleToLegacyBundle.get(entryBundle),
    );

    for (let id of outboundNodeIds) {
      let siblingBundle = nullthrows(idealBundleGraph.getNode(id));
      invariant(siblingBundle !== 'root');
      let legacySiblingBundle = nullthrows(
        idealBundleToLegacyBundle.get(siblingBundle),
      );
      bundleGraph.createBundleReference(legacyEntryBundle, legacySiblingBundle);
    }
  });

  // Step References: Add references to all bundles
  for (let [asset, references] of idealGraph.assetReference) {
    for (let [dependency, bundle] of references) {
      let legacyBundle = nullthrows(idealBundleToLegacyBundle.get(bundle));
      bundleGraph.createAssetReference(dependency, asset, legacyBundle);
    }
  }

  for (let [sharedBundleId, sourceBundleIds] of sharedToSourceBundleIds) {
    let sharedBundle = nullthrows(idealBundleGraph.getNode(sharedBundleId));
    if (sharedBundle === 'root') continue;
    let legacySharedBundle = nullthrows(
      idealBundleToLegacyBundle.get(sharedBundle),
    );
    for (let sourceBundleId of sourceBundleIds) {
      let sourceBundle = nullthrows(idealBundleGraph.getNode(sourceBundleId));
      if (sourceBundle === 'root') continue;
      let legacySourceBundle = nullthrows(
        idealBundleToLegacyBundle.get(sourceBundle),
      );
      bundleGraph.createBundleReference(legacySourceBundle, legacySharedBundle);
    }
  }
}

function createIdealGraph(
  assetGraph: MutableBundleGraph,
  config: ResolvedBundlerConfig,
): IdealGraph {
  // Asset to the bundle and group it's an entry of
  let bundleRoots: Map<BundleRoot, [NodeId, NodeId]> = new Map();
  let bundles: Map<string, NodeId> = new Map();
  let dependencyBundleGraph: DependencyBundleGraph = new ContentGraph();
  let assetReference: DefaultMap<
    Asset,
    Array<[Dependency, Bundle]>,
  > = new DefaultMap(() => []);

  let bundleGraph: Graph<Bundle | 'root'> = new Graph();
  let stack: Array<[BundleRoot, NodeId]> = [];

  let bundleRootEdgeTypes = {
    parallel: 1,
    lazy: 2,
  };
  // bundleGraph that models bundleRoots and async deps only
  let asyncBundleRootGraph: ContentGraph<
    BundleRoot | 'root',
    $Values<typeof bundleRootEdgeTypes>,
  > = new ContentGraph();

  let bundleGroupBundleIds: Set<NodeId> = new Set();

  // Models bundleRoots and the assets that require it synchronously
  let reachableRoots: ContentGraph<Asset> = new ContentGraph();

  // Step Create Entry Bundles: Find and create bundles for entries from assetGraph
  let entries: Map<Asset, Dependency> = new Map();
  let sharedToSourceBundleIds: Map<NodeId, Array<NodeId>> = new Map();

  assetGraph.traverse((node, context, actions) => {
    if (node.type !== 'asset') {
      return node;
    }

    invariant(
      context != null && context.type === 'dependency' && context.value.isEntry,
    );
    entries.set(node.value, context.value);
    actions.skipChildren();
  });

  let rootNodeId = nullthrows(asyncBundleRootGraph.addNode('root'));
  let bundleGraphRootNodeId = nullthrows(bundleGraph.addNode('root'));
  asyncBundleRootGraph.setRootNodeId(rootNodeId);
  bundleGraph.setRootNodeId(bundleGraphRootNodeId);

  for (let [asset, dependency] of entries) {
    let bundle = createBundle({
      asset,
      target: nullthrows(dependency.target),
      needsStableName: dependency.isEntry,
    });
    let nodeId = bundleGraph.addNode(bundle);
    bundles.set(asset.id, nodeId);
    bundleRoots.set(asset, [nodeId, nodeId]);
    asyncBundleRootGraph.addEdge(
      rootNodeId,
      asyncBundleRootGraph.addNodeByContentKey(asset.id, asset),
    );
    bundleGraph.addEdge(bundleGraphRootNodeId, nodeId);

    dependencyBundleGraph.addEdge(
      dependencyBundleGraph.addNodeByContentKeyIfNeeded(dependency.id, {
        value: dependency,
        type: 'dependency',
      }),
      dependencyBundleGraph.addNodeByContentKeyIfNeeded(String(nodeId), {
        value: bundle,
        type: 'bundle',
      }),
      dependencyPriorityEdges[dependency.priority],
    );
    bundleGroupBundleIds.add(nodeId);
  }

  let assets = [];

  let typeChangeIds = new Set();
  // Step Create Bundles: Traverse the asset graph and create bundles for asset type changes and async dependencies,
  // only adding the entry asset of each bundle, not the subgraph.
  assetGraph.traverse({
    enter(node, context, actions) {
      if (node.type === 'asset') {
        assets.push(node.value);

        let bundleIdTuple = bundleRoots.get(node.value);
        if (bundleIdTuple && bundleIdTuple[0] === bundleIdTuple[1]) {
          // Push to the stack when a new bundle is created
          stack.push([node.value, bundleIdTuple[0]]);
        } else if (bundleIdTuple) {
          stack.push([node.value, stack[stack.length - 1][1]]);
        }
      } else if (node.type === 'dependency') {
        if (context == null) {
          return node;
        }
        let dependency = node.value;

        if (assetGraph.isDependencySkipped(dependency)) {
          actions.skipChildren();
          return node;
        }

        invariant(context?.type === 'asset');
        let parentAsset = context.value;

        let assets = assetGraph.getDependencyAssets(dependency);
        if (assets.length === 0) {
          return node;
        }

        for (let childAsset of assets) {
          if (
            dependency.priority === 'lazy' ||
            childAsset.bundleBehavior === 'isolated'
          ) {
            let bundleId = bundles.get(childAsset.id);
            let bundle;
            if (bundleId == null) {
              let firstBundleGroup = nullthrows(
                bundleGraph.getNode(stack[0][1]),
              );
              invariant(firstBundleGroup !== 'root');
              bundle = createBundle({
                asset: childAsset,
                target: firstBundleGroup.target,
                needsStableName:
                  dependency.bundleBehavior === 'inline' ||
                  childAsset.bundleBehavior === 'inline'
                    ? false
                    : dependency.isEntry || dependency.needsStableName,
                bundleBehavior:
                  dependency.bundleBehavior ?? childAsset.bundleBehavior,
              });
              bundleId = bundleGraph.addNode(bundle);
              bundles.set(childAsset.id, bundleId);
              bundleRoots.set(childAsset, [bundleId, bundleId]);
              bundleGroupBundleIds.add(bundleId);
              bundleGraph.addEdge(bundleGraphRootNodeId, bundleId);
            } else {
              bundle = nullthrows(bundleGraph.getNode(bundleId));
              invariant(bundle !== 'root');

              if (
                // If this dependency requests isolated, but the bundle is not,
                // make the bundle isolated for all uses.
                dependency.bundleBehavior === 'isolated' &&
                bundle.bundleBehavior == null
              ) {
                bundle.bundleBehavior = dependency.bundleBehavior;
              }
            }

            dependencyBundleGraph.addEdge(
              dependencyBundleGraph.addNodeByContentKeyIfNeeded(dependency.id, {
                value: dependency,
                type: 'dependency',
              }),
              dependencyBundleGraph.addNodeByContentKeyIfNeeded(
                String(bundleId),
                {
                  value: bundle,
                  type: 'bundle',
                },
              ),
              dependencyPriorityEdges[dependency.priority],
            );
            continue;
          }
          if (
            parentAsset.type !== childAsset.type ||
            dependency.priority === 'parallel' ||
            childAsset.bundleBehavior === 'inline'
          ) {
            let [referencingBundleRoot, bundleGroupNodeId] = nullthrows(
              stack[stack.length - 1],
            );
            let bundleGroup = nullthrows(
              bundleGraph.getNode(bundleGroupNodeId),
            );
            invariant(bundleGroup !== 'root');

            // Find an existing bundle of the same type within the bundle group.
            let bundleId;
            let referencingBundleId = nullthrows(
              bundleRoots.get(referencingBundleRoot),
            )[0];
            let referencingBundle = nullthrows(
              bundleGraph.getNode(referencingBundleId),
            );
            invariant(referencingBundle !== 'root');
            let bundle;
            bundleId = bundles.get(childAsset.id);
            if (bundleId == null) {
              bundle = createBundle({
                // We either have an entry asset or a unique key.
                // Bundles created from type changes shouldn't have an entry asset.
                asset: childAsset,
                type: childAsset.type,
                env: childAsset.env,
                bundleBehavior: childAsset.bundleBehavior,
                target: referencingBundle.target,
                needsStableName:
                  childAsset.bundleBehavior === 'inline' ||
                  dependency.bundleBehavior === 'inline' ||
                  (dependency.priority === 'parallel' &&
                    !dependency.needsStableName)
                    ? false
                    : referencingBundle.needsStableName,
              });
              bundleId = bundleGraph.addNode(bundle);
              typeChangeIds.add(bundleId);
              if (
                // If this dependency requests isolated, but the bundle is not,
                // make the bundle isolated for all uses.
                dependency.bundleBehavior === 'isolated' &&
                bundle.bundleBehavior == null
              ) {
                bundle.bundleBehavior = dependency.bundleBehavior;
              }
            } else {
              // Otherwise, merge this asset into the existing bundle.
              bundle = bundleGraph.getNode(bundleId);
              invariant(bundle != null && bundle !== 'root');
            }

            bundles.set(childAsset.id, bundleId);
            // This may be wrong
            // A bundle can belong to multiple bundlegroups, all teh bundle groups of it's
            // ancestors, and all async and entry bundles before it are " bundle groups "
            bundleRoots.set(childAsset, [bundleId, bundleGroupNodeId]);
            bundleGraph.addEdge(referencingBundleId, bundleId);

            if (bundleId != bundleGroupNodeId) {
              dependencyBundleGraph.addEdge(
                dependencyBundleGraph.addNodeByContentKeyIfNeeded(
                  dependency.id,
                  {
                    value: dependency,
                    type: 'dependency',
                  },
                ),
                dependencyBundleGraph.addNodeByContentKeyIfNeeded(
                  String(bundleId),
                  {
                    value: bundle,
                    type: 'bundle',
                  },
                ),
                dependencyPriorityEdges.parallel,
              );

              // Add an edge from the bundle group entry to the new bundle.
              // This indicates that the bundle is loaded together with the entry
              //bundleGraph.addEdge(bundleGroupNodeId, bundleId);
            }

            assetReference.get(childAsset).push([dependency, bundle]);
            continue;
          }
        }
      }
      return node;
    },
    exit(node) {
      if (stack[stack.length - 1]?.[0] === node.value) {
        stack.pop();
      }
    },
  });

  // Step Merge Type Change Bundles: Clean up type change bundles within the same bundlegroups
  for (let [nodeIdA, a] of bundleGraph.nodes) {
    //if bundle b bundlegroups ==== bundle a bundlegroups then combine type changes
    for (let [nodeIdB, b] of bundleGraph.nodes) {
      if (
        a !== 'root' &&
        b !== 'root' &&
        a !== b &&
        typeChangeIds.has(nodeIdA) &&
        typeChangeIds.has(nodeIdB) &&
        a.bundleBehavior !== 'inline' &&
        b.bundleBehavior !== 'inline' &&
        a.type === b.type
      ) {
        let bundleBbundleGroups = getBundleGroupsForBundle(nodeIdB);
        let bundleABundleGroups = getBundleGroupsForBundle(nodeIdA);
        if (setEqual(bundleBbundleGroups, bundleABundleGroups)) {
          let shouldMerge = true;
          for (let depId of dependencyBundleGraph.getNodeIdsConnectedTo(
            dependencyBundleGraph.getNodeIdByContentKey(String(nodeIdB)),
            ALL_EDGE_TYPES,
          )) {
            let depNode = dependencyBundleGraph.getNode(depId);
            if (
              depNode &&
              depNode.type === 'dependency' &&
              depNode.value.specifierType === 'url'
            ) {
              shouldMerge = false;
              continue;
            }
          }
          if (!shouldMerge) continue;
          mergeBundle(nodeIdA, nodeIdB);
        }
      }
    }
  }

  // Step Determine Reachability: Determine reachability for every asset from each bundleRoot.
  // This is later used to determine which bundles to place each asset in.
  for (let [root] of bundleRoots) {
    if (!entries.has(root)) {
      asyncBundleRootGraph.addNodeByContentKey(root.id, root);
    }
  }

  for (let [root] of bundleRoots) {
    let rootNodeId = reachableRoots.addNodeByContentKeyIfNeeded(root.id, root);
    assetGraph.traverse((node, _, actions) => {
      if (node.value === root) {
        return;
      }
      if (node.type === 'dependency') {
        let dependency = node.value;

        if (dependencyBundleGraph.hasContentKey(dependency.id)) {
          if (dependency.priority !== 'sync') {
            let assets = assetGraph.getDependencyAssets(dependency);
            if (assets.length === 0) {
              return;
            }

            invariant(assets.length === 1);
            let bundleRoot = assets[0];
            let bundle = nullthrows(
              bundleGraph.getNode(nullthrows(bundles.get(bundleRoot.id))),
            );
            if (
              bundle !== 'root' &&
              bundle.bundleBehavior !== 'inline' &&
              !bundle.env.isIsolated()
            ) {
              asyncBundleRootGraph.addEdge(
                asyncBundleRootGraph.getNodeIdByContentKey(root.id),
                asyncBundleRootGraph.getNodeIdByContentKey(bundleRoot.id),
                dependency.priority === 'parallel'
                  ? bundleRootEdgeTypes.parallel
                  : bundleRootEdgeTypes.lazy,
              );
            }
          }
        }

        if (dependency.priority !== 'sync') {
          actions.skipChildren();
        }
        return;
      }
      //asset node type
      let asset = node.value;
      if (
        asset.bundleBehavior === 'isolated' ||
        asset.bundleBehavior === 'inline' ||
        root.type !== asset.type
      ) {
        actions.skipChildren();
        return;
      }
      let nodeId = reachableRoots.addNodeByContentKeyIfNeeded(
        node.value.id,
        node.value,
      );
      reachableRoots.addEdge(rootNodeId, nodeId);
    }, root);
  }

  // Maps a given bundleRoot to the assets reachable from it,
  // and the bundleRoots reachable from each of these assets
  let asyncAncestorAssets: Map<BundleRoot, Set<Asset>> = new Map();

  for (let entry of entries.keys()) {
    // Initialize an empty set of ancestors available to entries
    asyncAncestorAssets.set(entry, new Set());
  }

  // Step Determine Availability
  // Visit nodes in a topological order, visiting parent nodes before child nodes.
  // This allows us to construct an understanding of which assets will already be
  // loaded and available when a bundle runs, by pushing available assets downwards and
  // computing the intersection of assets available through all possible paths to a bundle.
  for (let nodeId of asyncBundleRootGraph.topoSort(ALL_EDGE_TYPES)) {
    const bundleRoot = asyncBundleRootGraph.getNode(nodeId);
    if (bundleRoot === 'root') continue;
    invariant(bundleRoot != null);
    let bundleGroupId = nullthrows(bundleRoots.get(bundleRoot))[1];

    let available;
    if (bundleRoot.bundleBehavior === 'isolated') {
      available = new Set();
    } else {
      available = new Set(asyncAncestorAssets.get(bundleRoot));
      for (let bundleIdInGroup of [
        bundleGroupId,
        ...bundleGraph.getNodeIdsConnectedFrom(bundleGroupId),
      ]) {
        let bundleInGroup = nullthrows(bundleGraph.getNode(bundleIdInGroup));
        invariant(bundleInGroup !== 'root');
        if (
          bundleInGroup.bundleBehavior === 'isolated' ||
          bundleInGroup.bundleBehavior === 'inline'
        ) {
          continue;
        }

        for (let bundleRoot of bundleInGroup.assets) {
          // Assets directly connected to current bundleRoot
          let assetsFromBundleRoot = reachableRoots
            .getNodeIdsConnectedFrom(
              reachableRoots.getNodeIdByContentKey(bundleRoot.id),
            )
            .map(id => nullthrows(reachableRoots.getNode(id)));

          for (let asset of [bundleRoot, ...assetsFromBundleRoot]) {
            available.add(asset);
          }
        }
      }
    }

    let children = asyncBundleRootGraph.getNodeIdsConnectedFrom(
      nodeId,
      ALL_EDGE_TYPES,
    );
    // Group assets available across our children by the child. This will be used
    // to determine borrowers if needed below.
    let parallelAvailability: Set<BundleRoot> = new Set();

    for (let childId of children) {
      let child = asyncBundleRootGraph.getNode(childId);
      invariant(child !== 'root' && child != null);
      let bundleBehavior = getBundleFromBundleRoot(child).bundleBehavior;
      if (bundleBehavior === 'isolated' || bundleBehavior === 'inline') {
        continue;
      }
      let isParallel = asyncBundleRootGraph.hasEdge(
        nodeId,
        childId,
        bundleRootEdgeTypes.parallel,
      );

      const childAvailableAssets = asyncAncestorAssets.get(child);
      let currentChildAvailable = isParallel
        ? setUnion(parallelAvailability, available)
        : available;
      if (childAvailableAssets != null) {
        setIntersect(childAvailableAssets, currentChildAvailable);
      } else {
        asyncAncestorAssets.set(child, new Set(currentChildAvailable));
      }
      if (isParallel) {
        let assetsFromBundleRoot = reachableRoots
          .getNodeIdsConnectedFrom(
            reachableRoots.getNodeIdByContentKey(child.id),
          )
          .map(id => nullthrows(reachableRoots.getNode(id)));
        parallelAvailability = setUnion(
          parallelAvailability,
          assetsFromBundleRoot,
        );
      }
    }
  }
  // Step Internalize async bundles
  for (let [id, bundleRoot] of asyncBundleRootGraph.nodes) {
    if (bundleRoot === 'root') continue;
    let parentRoots = asyncBundleRootGraph
      .getNodeIdsConnectedTo(id, ALL_EDGE_TYPES)
      .map(id => nullthrows(asyncBundleRootGraph.getNode(id)));
    let canDelete =
      getBundleFromBundleRoot(bundleRoot).bundleBehavior !== 'isolated';
    if (parentRoots.length === 0) continue;
    for (let parent of parentRoots) {
      if (parent === 'root') {
        canDelete = false;
        continue;
      }
      if (
        reachableRoots.hasEdge(
          reachableRoots.getNodeIdByContentKey(parent.id),
          reachableRoots.getNodeIdByContentKey(bundleRoot.id),
        ) ||
        asyncAncestorAssets.get(parent)?.has(bundleRoot)
      ) {
        let parentBundle = bundleGraph.getNode(
          nullthrows(bundles.get(parent.id)),
        );
        invariant(parentBundle != null && parentBundle !== 'root');
        parentBundle.internalizedAssetIds.push(bundleRoot.id);
      } else {
        canDelete = false;
      }
    }
    if (canDelete) {
      deleteBundle(bundleRoot);
    }
  }

  // Step Insert Or Share: Place all assets into bundles or create shared bundles. Each asset
  // is placed into a single bundle based on the bundle entries it is reachable from.
  // This creates a maximally code split bundle graph with no duplication.
  for (let asset of assets) {
    // Unreliable bundleRoot assets which need to pulled in by shared bundles or other means

    let reachable: Array<BundleRoot> = getReachableBundleRoots(
      asset,
      reachableRoots,
    ).reverse();

    let reachableEntries = reachable.filter(
      a =>
        entries.has(a) ||
        !a.isBundleSplittable ||
        getBundleFromBundleRoot(a).needsStableName ||
        getBundleFromBundleRoot(a).bundleBehavior === 'isolated',
    );
    reachable = reachable.filter(
      a =>
        !entries.has(a) &&
        a.isBundleSplittable &&
        !getBundleFromBundleRoot(a).needsStableName &&
        getBundleFromBundleRoot(a).bundleBehavior !== 'isolated',
    );

    // Filter out bundles from this asset's reachable array if
    // bundle does not contain the asset in its ancestry
    reachable = reachable.filter(b => !asyncAncestorAssets.get(b)?.has(asset));

    reachable = reachable.filter(b => {
      if (b.env.isIsolated()) {
        return true;
      }
      let toKeep = true;
      if (bundles.has(asset.id)) {
        toKeep = false;
        bundleGraph.addEdge(
          nullthrows(bundles.get(b.id)),
          nullthrows(bundles.get(asset.id)),
        );
      }
      for (let f of reachable) {
        if (b === f) continue;
        let fReachable = getReachableBundleRoots(f, reachableRoots).filter(
          b => !asyncAncestorAssets.get(b)?.has(f),
        );
        if (fReachable.indexOf(b) > -1) {
          toKeep = false;
          bundleGraph.addEdge(
            nullthrows(bundles.get(b.id)),
            nullthrows(bundles.get(f.id)),
          );
        }
      }
      return toKeep;
    });

    // Add assets to non-splittable bundles.
    for (let entry of reachableEntries) {
      let entryBundleId = nullthrows(bundles.get(entry.id));
      let entryBundle = nullthrows(bundleGraph.getNode(entryBundleId));
      invariant(entryBundle !== 'root');
      entryBundle.assets.add(asset);
      entryBundle.size += asset.stats.size;
    }

    // Create shared bundles for splittable bundles.
    if (reachable.length > 0) {
      let sourceBundles = reachable.map(a => nullthrows(bundles.get(a.id)));
      let key = reachable.map(a => a.id).join(',');
      let bundleId = bundles.get(key);
      let bundle;
      if (bundleId == null) {
        let firstSourceBundle = nullthrows(
          bundleGraph.getNode(sourceBundles[0]),
        );
        invariant(firstSourceBundle !== 'root');
        bundle = createBundle({
          target: firstSourceBundle.target,
          type: firstSourceBundle.type,
          env: firstSourceBundle.env,
        });
        bundle.sourceBundles = sourceBundles;
        let sharedInternalizedAssets = new Set(
          firstSourceBundle.internalizedAssetIds,
        );

        for (let p of sourceBundles) {
          let parentBundle = nullthrows(bundleGraph.getNode(p));
          invariant(parentBundle !== 'root');
          if (parentBundle === firstSourceBundle) continue;
          setIntersect(
            sharedInternalizedAssets,
            new Set(parentBundle.internalizedAssetIds),
          );
        }
        bundle.internalizedAssetIds = [...sharedInternalizedAssets];
        bundleId = bundleGraph.addNode(bundle);
        bundles.set(key, bundleId);
      } else {
        bundle = nullthrows(bundleGraph.getNode(bundleId));
        invariant(bundle !== 'root');
      }
      bundle.assets.add(asset);
      bundle.size += asset.stats.size;

      for (let sourceBundleId of sourceBundles) {
        if (bundleId !== sourceBundleId) {
          bundleGraph.addEdge(sourceBundleId, bundleId);
        }
      }
      sharedToSourceBundleIds.set(bundleId, sourceBundles);

      dependencyBundleGraph.addNodeByContentKeyIfNeeded(String(bundleId), {
        value: bundle,
        type: 'bundle',
      });
    }
  }

  // Step Merge Share Bundles: Merge any shared bundles under the minimum bundle size back into
  // their source bundles, and remove the bundle.
  for (let [bundleNodeId, bundle] of bundleGraph.nodes) {
    if (bundle === 'root') continue;
    if (bundle.sourceBundles.length > 0 && bundle.size < config.minBundleSize) {
      sharedToSourceBundleIds.delete(bundleNodeId);
      removeBundle(bundleGraph, bundleNodeId, assetReference);
    }
  }

  function deleteBundle(bundleRoot: BundleRoot) {
    bundleGraph.removeNode(nullthrows(bundles.get(bundleRoot.id)));
    bundleRoots.delete(bundleRoot);
    bundles.delete(bundleRoot.id);
    if (reachableRoots.hasContentKey(bundleRoot.id)) {
      reachableRoots.replaceNodeIdsConnectedTo(
        reachableRoots.getNodeIdByContentKey(bundleRoot.id),
        [],
      );
    }
    if (asyncBundleRootGraph.hasContentKey(bundleRoot.id)) {
      asyncBundleRootGraph.removeNode(
        asyncBundleRootGraph.getNodeIdByContentKey(bundleRoot.id),
      );
    }
  }
  function getBundleGroupsForBundle(nodeId: NodeId) {
    let bundleGroupBundleIds = new Set();
    bundleGraph.traverseAncestors(nodeId, ancestorId => {
      if (
        bundleGraph
          .getNodeIdsConnectedTo(ancestorId)
          .includes(bundleGraph.rootNodeId)
      ) {
        bundleGroupBundleIds.add(ancestorId);
      }
    });
    return bundleGroupBundleIds;
  }

  function mergeBundle(mainNodeId: NodeId, otherNodeId: NodeId) {
    //merges assets of "otherRoot" into "mainBundleRoot"
    let a = nullthrows(bundleGraph.getNode(mainNodeId));
    let b = nullthrows(bundleGraph.getNode(otherNodeId));
    invariant(a !== 'root' && b !== 'root');
    let bundleRootB = nullthrows(b.mainEntryAsset);
    let mainBundleRoot = nullthrows(a.mainEntryAsset);
    for (let asset of a.assets) {
      b.assets.add(asset);
    }
    a.assets = b.assets;
    for (let depId of dependencyBundleGraph.getNodeIdsConnectedTo(
      dependencyBundleGraph.getNodeIdByContentKey(String(otherNodeId)),
      ALL_EDGE_TYPES,
    )) {
      dependencyBundleGraph.replaceNodeIdsConnectedTo(depId, [
        dependencyBundleGraph.getNodeIdByContentKey(String(mainNodeId)),
      ]);
    }

    //clean up asset reference
    for (let dependencyTuple of assetReference.get(bundleRootB)) {
      dependencyTuple[1] = a;
    }
    //add in any lost edges
    for (let nodeId of bundleGraph.getNodeIdsConnectedTo(otherNodeId)) {
      bundleGraph.addEdge(nodeId, mainNodeId);
    }
    deleteBundle(bundleRootB);

    bundleRoots.set(bundleRootB, [
      mainNodeId,
      bundleRoots.get(mainBundleRoot)[1],
    ]);
    bundles.set(bundleRootB.id, mainNodeId);
  }
  function getBundleFromBundleRoot(bundleRoot: BundleRoot): Bundle {
    let bundle = bundleGraph.getNode(
      nullthrows(bundleRoots.get(bundleRoot))[0],
    );
    invariant(bundle !== 'root' && bundle != null);
    return bundle;
  }

  return {
    bundleGraph,
    dependencyBundleGraph,
    bundleGroupBundleIds,
    assetReference,
    sharedToSourceBundleIds,
  };
}

const CONFIG_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    http: {
      type: 'number',
      enum: Object.keys(HTTP_OPTIONS).map(k => Number(k)),
    },
    minBundles: {
      type: 'number',
    },
    minBundleSize: {
      type: 'number',
    },
    maxParallelRequests: {
      type: 'number',
    },
  },
  additionalProperties: false,
};

function createBundle(opts: {|
  uniqueKey?: string,
  target: Target,
  asset?: Asset,
  env?: Environment,
  type?: string,
  needsStableName?: boolean,
  bundleBehavior?: ?BundleBehavior,
|}): Bundle {
  if (opts.asset == null) {
    return {
      uniqueKey: opts.uniqueKey,
      assets: new Set(),
      internalizedAssetIds: [],
      mainEntryAsset: null,
      size: 0,
      sourceBundles: [],
      target: opts.target,
      type: nullthrows(opts.type),
      env: nullthrows(opts.env),
      needsStableName: Boolean(opts.needsStableName),
      bundleBehavior: opts.bundleBehavior,
    };
  }

  let asset = nullthrows(opts.asset);
  return {
    uniqueKey: opts.uniqueKey,
    assets: new Set([asset]),
    internalizedAssetIds: [],
    mainEntryAsset: asset,
    size: asset.stats.size,
    sourceBundles: [],
    target: opts.target,
    type: opts.type ?? asset.type,
    env: opts.env ?? asset.env,
    needsStableName: Boolean(opts.needsStableName),
    bundleBehavior: opts.bundleBehavior ?? asset.bundleBehavior,
  };
}

function removeBundle(
  bundleGraph: Graph<Bundle | 'root'>,
  bundleId: NodeId,
  assetReference: DefaultMap<Asset, Array<[Dependency, Bundle]>>,
) {
  let bundle = nullthrows(bundleGraph.getNode(bundleId));
  invariant(bundle !== 'root');
  for (let asset of bundle.assets) {
    assetReference.set(
      asset,
      assetReference.get(asset).filter(t => !t.includes(bundle)),
    );
    for (let sourceBundleId of bundle.sourceBundles) {
      let sourceBundle = nullthrows(bundleGraph.getNode(sourceBundleId));
      invariant(sourceBundle !== 'root');
      sourceBundle.assets.add(asset);
      sourceBundle.size += asset.stats.size;
    }
  }

  bundleGraph.removeNode(bundleId);
}

async function loadBundlerConfig(
  config: Config,
  options: PluginOptions,
): Promise<ResolvedBundlerConfig> {
  let conf = await config.getConfig<BundlerConfig>([], {
    packageKey: '@parcel/bundler-default',
  });

  if (!conf) {
    return HTTP_OPTIONS['2'];
  }

  invariant(conf?.contents != null);

  validateSchema.diagnostic(
    CONFIG_SCHEMA,
    {
      data: conf?.contents,
      source: await options.inputFS.readFile(conf.filePath, 'utf8'),
      filePath: conf.filePath,
      prependKey: `/${encodeJSONKeyComponent('@parcel/bundler-default')}`,
    },
    '@parcel/bundler-default',
    'Invalid config for @parcel/bundler-default',
  );

  let http = conf.contents.http ?? 2;
  let defaults = HTTP_OPTIONS[http];

  return {
    minBundles: conf.contents.minBundles ?? defaults.minBundles,
    minBundleSize: conf.contents.minBundleSize ?? defaults.minBundleSize,
    maxParallelRequests:
      conf.contents.maxParallelRequests ?? defaults.maxParallelRequests,
  };
}

function getReachableBundleRoots(asset, graph): Array<BundleRoot> {
  return graph
    .getNodeIdsConnectedTo(graph.getNodeIdByContentKey(asset.id))
    .map(nodeId => nullthrows(graph.getNode(nodeId)));
}
