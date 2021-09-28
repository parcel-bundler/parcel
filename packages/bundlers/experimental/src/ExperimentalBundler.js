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
import {validateSchema, DefaultMap} from '@parcel/utils';
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
  assets: Set<Asset>,
  internalizedAssetIds: Array<AssetId>,
  bundleBehavior?: ?BundleBehavior,
  needsStableName: boolean,
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
  bundleGroupBundleIds: Array<NodeId>,
  assetReference: DefaultMap<Asset, Array<[Dependency, Bundle]>>,
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
  } = idealGraph;
  let entryBundleToBundleGroup: Map<NodeId, BundleGroup> = new Map();

  // Step 1: Create bundle groups, bundles, and shared bundles and add assets to them
  for (let [bundleNodeId, idealBundle] of idealBundleGraph.nodes) {
    if (idealBundle === 'root') continue;
    let [entryAsset] = [...idealBundle.assets];
    let bundleGroup;
    let bundle;

    if (bundleGroupBundleIds.includes(bundleNodeId)) {
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
    } else {
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
  // Step 2: Internalize dependencies for bundles
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
          bundle.hasDependency(incomingDep)
        ) {
          bundleGraph.internalizeAsyncDependency(bundle, incomingDep);
        }
      }
    }
  }
  // Step 3: Add bundles to their bundle groups
  for (let [bundleId, bundleGroup] of entryBundleToBundleGroup) {
    let outboundNodeIds = idealBundleGraph.getNodeIdsConnectedFrom(bundleId);
    for (let id of outboundNodeIds) {
      let siblingBundle = nullthrows(idealBundleGraph.getNode(id));
      invariant(siblingBundle !== 'root');
      let legacySiblingBundle = nullthrows(
        idealBundleToLegacyBundle.get(siblingBundle),
      );
      bundleGraph.addBundleToBundleGroup(legacySiblingBundle, bundleGroup);
    }
  }

  // Step 4: Add references to all bundles
  for (let [asset, references] of idealGraph.assetReference) {
    for (let [dependency, bundle] of references) {
      let legacyBundle = nullthrows(idealBundleToLegacyBundle.get(bundle));
      bundleGraph.createAssetReference(dependency, asset, legacyBundle);
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

  // bundleRoot to all bundleRoot descendants
  let reachableBundles: DefaultMap<
    BundleRoot,
    Set<BundleRoot>,
  > = new DefaultMap(() => new Set());

  let bundleGraph: Graph<Bundle | 'root'> = new Graph();
  let stack: Array<[BundleRoot, NodeId]> = [];

  // bundleGraph that models bundleRoots and async deps only
  let asyncBundleRootGraph: ContentGraph<
    BundleRoot | 'root',
  > = new ContentGraph();
  let bundleGroupBundleIds: Array<NodeId> = [];

  // Step 1: Find and create bundles for entries from assetGraph
  let entries: Map<Asset, Dependency> = new Map();
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
    bundleGroupBundleIds.push(nodeId);
  }

  let assets = [];

  // Step 2: Traverse the asset graph and create bundles for asset type changes and async dependencies,
  // only adding the entry asset of each bundle, not the subgraph.
  assetGraph.traverse({
    enter(node, context) {
      if (node.type === 'asset') {
        assets.push(node.value);

        let bundleIdTuple = bundleRoots.get(node.value);
        if (bundleIdTuple) {
          // Push to the stack when a new bundle is created
          stack.push([node.value, bundleIdTuple[1]]);
        }
      } else if (node.type === 'dependency') {
        if (context == null) {
          return node;
        }
        let dependency = node.value;

        invariant(context?.type === 'asset');
        let parentAsset = context.value;

        let assets = assetGraph.getDependencyAssets(dependency);
        if (assets.length === 0) {
          return node;
        }

        invariant(assets.length === 1);
        let childAsset = assets[0];
        if (
          dependency.priority === 'lazy' ||
          childAsset.bundleBehavior === 'isolated'
        ) {
          let bundleId = bundles.get(childAsset.id);
          let bundle;
          if (bundleId == null) {
            let firstBundleGroup = nullthrows(bundleGraph.getNode(stack[0][1]));
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
            bundleGroupBundleIds.push(bundleId);
            bundleGraph.addEdge(bundleGraphRootNodeId, bundleId);
          } else {
            bundle = nullthrows(bundleGraph.getNode(bundleId));
            invariant(bundle !== 'root');
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

          // Walk up the stack until we hit a different asset type
          // and mark each bundle as reachable from every parent bundle
          for (let i = stack.length - 1; i >= 0; i--) {
            let [stackAsset] = stack[i];
            if (
              stackAsset.type !== childAsset.type ||
              stackAsset.env.context !== childAsset.env.context ||
              stackAsset.env.isIsolated()
            ) {
              break;
            }
            reachableBundles.get(stackAsset).add(childAsset);
          }
          return node;
        }
        if (
          parentAsset.type !== childAsset.type ||
          childAsset.bundleBehavior === 'inline'
        ) {
          let [, bundleGroupNodeId] = nullthrows(stack[stack.length - 1]);
          let bundleGroup = nullthrows(bundleGraph.getNode(bundleGroupNodeId));
          invariant(bundleGroup !== 'root');
          let bundle = createBundle({
            asset: childAsset,
            target: bundleGroup.target,
            needsStableName: dependency.bundleBehavior === 'inline',
          });
          let bundleId = bundleGraph.addNode(bundle);
          bundles.set(childAsset.id, bundleId);
          bundleRoots.set(childAsset, [bundleId, bundleGroupNodeId]);
          bundleGraph.addEdge(bundleGraphRootNodeId, bundleId);

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
            dependencyPriorityEdges.parallel,
          );
          // Add an edge from the bundle group entry to the new bundle.
          // This indicates that the bundle is loaded together with the entry
          bundleGraph.addEdge(bundleGroupNodeId, bundleId);
          assetReference.get(childAsset).push([dependency, bundle]);
          return node;
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

  // Step 3: Determine reachability for every asset from each bundleRoot.
  // This is later used to determine which bundles to place each asset in.
  for (let [root] of bundleRoots) {
    if (!entries.has(root)) {
      asyncBundleRootGraph.addNodeByContentKey(root.id, root);
    }
  }

  // Models bundleRoots and the assets that require it synchronously
  let reachableRoots: ContentGraph<Asset> = new ContentGraph();
  for (let [root] of bundleRoots) {
    let rootNodeId = reachableRoots.addNodeByContentKeyIfNeeded(root.id, root);
    assetGraph.traverse((node, isAsync, actions) => {
      if (node.value === root) {
        return;
      }

      if (node.type === 'dependency') {
        let dependency = node.value;
        if (dependencyBundleGraph.hasContentKey(dependency.id)) {
          if (dependency.priority === 'lazy') {
            let assets = assetGraph.getDependencyAssets(dependency);
            if (assets.length === 0) {
              return node;
            }

            invariant(assets.length === 1);
            let bundleRoot = assets[0];
            if (dependency.specifierType !== 'url') {
              asyncBundleRootGraph.addEdge(
                asyncBundleRootGraph.getNodeIdByContentKey(root.id),
                asyncBundleRootGraph.getNodeIdByContentKey(bundleRoot.id),
              );
            }
          }
          actions.skipChildren();
          return;
        }
        return;
      }

      let nodeId = reachableRoots.addNodeByContentKeyIfNeeded(
        node.value.id,
        node.value,
      );
      reachableRoots.addEdge(rootNodeId, nodeId);
    }, root);
  }

  // Maps a given bundleRoot to the bundleRoots reachable from it,
  // and the assets reachable from each of these bundleRoots
  let ancestorAssets: Map<
    BundleRoot,
    Map<BundleRoot, Array<Asset> | null>,
  > = new Map();

  // Reference count of each asset available within a given bundleRoot's bundle group
  let assetRefsInBundleGroup: DefaultMap<
    BundleRoot,
    DefaultMap<Asset, number>,
  > = new DefaultMap(() => new DefaultMap(() => 0));

  // Step 4: Determine assets that should be duplicated by computing asset availability in each bundle group
  for (let nodeId of asyncBundleRootGraph.topoSort()) {
    const bundleRoot = asyncBundleRootGraph.getNode(nodeId);
    if (bundleRoot === 'root') continue;
    invariant(bundleRoot != null);
    // BundleRoots reachable from current (bundleRoot) node mapped to assets that are available from it
    // should we call these reachableBundleRoots/reachableBundleRootMap instead?
    let ancestors = ancestorAssets.get(bundleRoot);

    // First consider bundle group asset availability, processing only
    // non-isolated bundles within that bundle group
    let bundleGroupId = nullthrows(bundleRoots.get(bundleRoot))[1];
    // Map of assets in the bundle group to their refcounts
    let assetRefs = assetRefsInBundleGroup.get(bundleRoot);

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
      let [bundleRoot] = [...bundleInGroup.assets];
      // Assets directly connected to current bundleRoot
      let assetsFromBundleRoot = reachableRoots
        .getNodeIdsConnectedFrom(
          reachableRoots.getNodeIdByContentKey(bundleRoot.id),
        )
        .map(id => nullthrows(reachableRoots.getNode(id)));

      for (let asset of assetsFromBundleRoot) {
        assetRefs.set(asset, assetRefs.get(asset) + 1);
      }
    }

    // Enumerate bundleRoots connected to the node (parent), taking the intersection
    // between the assets synchronously loaded by the parent, and those loaded by the child.
    let bundleGroupAssets = new Set(assetRefs.keys());

    let combined = ancestors
      ? new Map([...bundleGroupAssets, ...ancestors.keys()].map(a => [a, null]))
      : new Map([...bundleGroupAssets].map(a => [a, null]));

    let children = asyncBundleRootGraph.getNodeIdsConnectedFrom(nodeId);

    for (let childId of children) {
      let child = asyncBundleRootGraph.getNode(childId);
      invariant(child !== 'root' && child != null);
      const availableAssets = ancestorAssets.get(child);

      if (availableAssets === undefined) {
        ancestorAssets.set(child, combined);
      } else {
        ancestryIntersect(availableAssets, combined);
      }
    }

    let siblingAncestors = ancestors
      ? ancestryUnion(new Set(ancestors.keys()), assetRefs, bundleRoot)
      : new Map([...bundleGroupAssets].map(a => [a, [bundleRoot]]));

    for (let bundleIdInGroup of bundleGraph.getNodeIdsConnectedFrom(
      bundleGroupId,
    )) {
      let bundleInGroup = bundleGraph.getNode(bundleIdInGroup);
      invariant(
        bundleInGroup != null &&
          bundleInGroup !== 'root' &&
          bundleInGroup.assets != null,
      );

      let [bundleRoot] = [...bundleInGroup.assets];

      const availableAssets = ancestorAssets.get(bundleRoot);

      if (availableAssets === undefined) {
        ancestorAssets.set(bundleRoot, siblingAncestors);
      } else {
        ancestryIntersect(availableAssets, siblingAncestors);
      }
    }
  }

  // Step 5: Place all assets into bundles or create shared bundles. Each asset
  // is placed into a single bundle based on the bundle entries it is reachable from.
  // This creates a maximally code split bundle graph with no duplication.
  for (let asset of assets) {
    // Unreliable bundleRoot assets which need to pulled in by shared bundles or other means
    let reachable: Array<BundleRoot> = getReachableBundleRoots(
      asset,
      reachableRoots,
    ).reverse();

    // Filter out bundles from this asset's reachable array if
    // bundle does not contain the asset in its ancestry
    // or if any of the bundles in the ancestry have a refcount of <= 1 for that asset,
    // meaning it may not be deduplicated. Otherwise, decrement all references in
    // the ancestry and keep it
    reachable = reachable.filter(b => {
      let ancestry = ancestorAssets.get(b)?.get(asset);
      if (ancestry === undefined) {
        // No reachable assets from this bundle
        return true;
      } else if (ancestry === null) {
        // Asset is reachable via the bundle
        return false;
      } else {
        if (
          ancestry.every(
            bundleId => assetRefsInBundleGroup.get(bundleId).get(asset) > 1,
          )
        ) {
          for (let bundleRoot of ancestry) {
            assetRefsInBundleGroup
              .get(bundleRoot)
              .set(
                asset,
                assetRefsInBundleGroup.get(bundleRoot).get(asset) - 1,
              );
          }
          return false;
        }
        return true;
      }
    });

    let rootBundleTuple = bundleRoots.get(asset);
    if (rootBundleTuple != null) {
      let rootBundle = nullthrows(bundleGraph.getNode(rootBundleTuple[0]));
      invariant(rootBundle !== 'root');

      if (!rootBundle.env.isIsolated()) {
        if (!bundles.has(asset.id)) {
          bundles.set(asset.id, rootBundleTuple[0]);
        }

        for (let reachableAsset of reachable) {
          if (reachableAsset !== asset) {
            bundleGraph.addEdge(
              nullthrows(bundleRoots.get(reachableAsset))[1],
              rootBundleTuple[0],
            );
          }
        }

        let willInternalizeRoots = asyncBundleRootGraph
          .getNodeIdsConnectedTo(
            asyncBundleRootGraph.getNodeIdByContentKey(asset.id),
          )
          .map(id => nullthrows(asyncBundleRootGraph.getNode(id)))
          .filter(bundleRoot => {
            if (bundleRoot === 'root') {
              return false;
            }

            return (
              reachableRoots.hasEdge(
                reachableRoots.getNodeIdByContentKey(bundleRoot.id),
                reachableRoots.getNodeIdByContentKey(asset.id),
              ) || ancestorAssets.get(bundleRoot)?.has(asset)
            );
          })
          .map(bundleRoot => {
            // For Flow
            invariant(bundleRoot !== 'root');
            return bundleRoot;
          });

        for (let bundleRoot of willInternalizeRoots) {
          if (bundleRoot !== asset) {
            let bundle = nullthrows(
              bundleGraph.getNode(nullthrows(bundles.get(bundleRoot.id))),
            );
            invariant(bundle !== 'root');
            bundle.internalizedAssetIds.push(asset.id);
          }
        }
      }
    } else if (reachable.length > 0) {
      let sourceBundles = reachable.map(a => nullthrows(bundles.get(a.id)));
      let sourceBundleSet = new Set([...sourceBundles]);
      let toRemove: Set<NodeId> = new Set();
      for (let bundleId of sourceBundles) {
        // entries should not be considered in reachablility
        for (let id of bundleGraph.getNodeIdsConnectedTo(bundleId)) {
          if (sourceBundleSet.has(id)) {
            toRemove.add(id);
          }
        }
      }
      reachable = reachable.filter(
        a => !toRemove.has(nullthrows(bundles.get(a.id))),
      );

      if (reachable.length < 1) {
        continue;
      }

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
        bundleId = bundleGraph.addNode(bundle);
        bundles.set(key, bundleId);
        bundleGraph.addEdge(bundleGraphRootNodeId, bundleId);
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
      dependencyBundleGraph.addNodeByContentKeyIfNeeded(String(bundleId), {
        value: bundle,
        type: 'bundle',
      });
    }
  }

  // Step 7: Merge any sibling bundles required by entry bundles back into the entry bundle.
  // Entry bundles must be predictable, so cannot have unpredictable siblings.
  for (let [bundleNodeId, bundle] of bundleGraph.nodes) {
    if (bundle === 'root') continue;
    if (bundle.sourceBundles.length > 0 && bundle.size < config.minBundleSize) {
      removeBundle(bundleGraph, bundleNodeId);
    }
  }

  for (let entryAsset of entries.keys()) {
    let entryBundleId = nullthrows(bundleRoots.get(entryAsset)?.[0]);
    let entryBundle = nullthrows(bundleGraph.getNode(entryBundleId));
    for (let siblingId of bundleGraph.getNodeIdsConnectedFrom(entryBundleId)) {
      let sibling = nullthrows(bundleGraph.getNode(siblingId));
      invariant(entryBundle !== 'root' && sibling !== 'root');
      if (
        sibling.type !== entryBundle.type ||
        sibling.bundleBehavior === 'inline'
      ) {
        continue;
      }
      for (let asset of sibling.assets) {
        entryBundle.assets.add(asset);
        entryBundle.size += asset.stats.size;
      }
      bundleGraph.removeEdge(entryBundleId, siblingId);
      if (sibling.sourceBundles.length > 1) {
        let entryBundleIndex = sibling.sourceBundles.indexOf(entryBundleId);
        invariant(entryBundleIndex >= 0);
        sibling.sourceBundles.splice(entryBundleIndex, 1);

        if (sibling.sourceBundles.length === 1) {
          let id = sibling.sourceBundles.pop();
          let bundle = nullthrows(bundleGraph.getNode(id));
          invariant(bundle !== 'root');
          for (let asset of sibling.assets) {
            bundle.assets.add(asset);
            bundle.size += asset.stats.size;
          }
          bundleGraph.removeEdge(id, siblingId);
        }
      }
    }
  }

  return {
    bundleGraph,
    dependencyBundleGraph,
    bundleGroupBundleIds,
    assetReference,
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

function createBundle(
  opts:
    | {|
        target: Target,
        env: Environment,
        type: string,
        needsStableName?: boolean,
        bundleBehavior?: ?BundleBehavior,
      |}
    | {|
        target: Target,
        asset: Asset,
        env?: Environment,
        type?: string,
        needsStableName?: boolean,
        bundleBehavior?: ?BundleBehavior,
      |},
): Bundle {
  if (opts.asset == null) {
    return {
      assets: new Set(),
      internalizedAssetIds: [],
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
    assets: new Set([asset]),
    internalizedAssetIds: [],
    size: asset.stats.size,
    sourceBundles: [],
    target: opts.target,
    type: opts.type ?? asset.type,
    env: opts.env ?? asset.env,
    needsStableName: Boolean(opts.needsStableName),
    bundleBehavior: opts.bundleBehavior ?? asset.bundleBehavior,
  };
}

function removeBundle(bundleGraph: Graph<Bundle | 'root'>, bundleId: NodeId) {
  let bundle = nullthrows(bundleGraph.getNode(bundleId));
  invariant(bundle !== 'root');

  for (let asset of bundle.assets) {
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

function ancestryUnion(
  ancestors: Set<BundleRoot>,
  assetRefs: Map<Asset, number>,
  bundleRoot: BundleRoot,
): Map<Asset, Array<BundleRoot> | null> {
  let map = new Map();
  for (let a of ancestors) {
    map.set(a, null);
  }
  for (let [asset, refCount] of assetRefs) {
    if (!ancestors.has(asset) && refCount > 1) {
      map.set(asset, [bundleRoot]);
    }
  }
  return map;
}

function ancestryIntersect(
  currentMap: Map<BundleRoot, Array<Asset> | null>,
  map: Map<BundleRoot, Array<Asset> | null>,
): void {
  for (let [bundleRoot, currentAssets] of currentMap) {
    if (map.has(bundleRoot)) {
      let assets = map.get(bundleRoot);
      if (assets) {
        if (currentAssets) {
          currentAssets.push(...assets);
        } else {
          currentMap.set(bundleRoot, [...assets]);
        }
      }
    } else {
      currentMap.delete(bundleRoot);
    }
  }
}

function getReachableBundleRoots(asset, graph): Array<BundleRoot> {
  return graph
    .getNodeIdsConnectedTo(graph.getNodeIdByContentKey(asset.id))
    .map(nodeId => nullthrows(graph.getNode(nodeId)));
}
