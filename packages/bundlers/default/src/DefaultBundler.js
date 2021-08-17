// @flow strict-local

import type {
  Asset,
  Bundle as LegacyBundle,
  BundleBehavior,
  BundleGroup,
  Dependency,
  DependencyPriority,
  Environment,
  Config,
  MutableBundleGraph,
  PluginOptions,
  Target,
} from '@parcel/types';
import type {NodeId} from '@parcel/core/src/types';
import type {SchemaEntity} from '@parcel/utils';

import Graph from '@parcel/core/src/Graph';
import ContentGraph from '@parcel/core/src/ContentGraph';
import dumpGraphToGraphViz from '@parcel/core/src/dumpGraphToGraphViz';

import invariant from 'assert';
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

type DependencyBundleGraph = ContentGraph<
  | {|
      value: Bundle,
      type: 'bundle',
    |}
  | {|
      value: Dependency,
      type: 'dependency',
    |},
  DependencyPriority,
>;
type IdealGraph = {|
  dependencyBundleGraph: DependencyBundleGraph,
  bundleGraph: Graph<Bundle>,
  bundleGroupBundleIds: Array<NodeId>,
  entryBundles: Array<NodeId>,
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

/**
 Test: does not create bundles for dynamic imports when assets are available up the graph
 Issue: Ideal bundlegraph creates dynamic import bundle & will not place asset in both bundle groups/bundles even if asset is present statically "up the tree"
 */
function decorateLegacyGraph(
  idealGraph: IdealGraph,
  bundleGraph: MutableBundleGraph,
): void {
  //TODO add in reference edges based on stored assets from create ideal graph
  let idealBundleToLegacyBundle: Map<Bundle, LegacyBundle> = new Map();

  let {
    bundleGraph: idealBundleGraph,
    dependencyBundleGraph,
    bundleGroupBundleIds,
  } = idealGraph;
  let entryBundleToBundleGroup: Map<NodeId, BundleGroup> = new Map();

  for (let [bundleNodeId, idealBundle] of idealBundleGraph.nodes) {
    let [entryAsset] = [...idealBundle.assets];
    // This entry asset is the first asset of the bundle (not entry file asset)
    let bundleGroup;
    let bundle;

    if (bundleGroupBundleIds.includes(bundleNodeId)) {
      let dependencies = dependencyBundleGraph
        .getNodeIdsConnectedTo(
          dependencyBundleGraph.getNodeIdByContentKey(String(bundleNodeId)),
          ['lazy', 'sync', 'parallel'],
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
      //TODO this should be > 1
      //this should only happen for shared bundles

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

  for (let [, idealBundle] of idealBundleGraph.nodes) {
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

  for (let [bundleId, bundleGroup] of entryBundleToBundleGroup) {
    let outboundNodeIds = idealBundleGraph.getNodeIdsConnectedFrom(bundleId);
    for (let id of outboundNodeIds) {
      let siblingBundle = nullthrows(idealBundleGraph.getNode(id));
      let legacySiblingBundle = nullthrows(
        idealBundleToLegacyBundle.get(siblingBundle),
      );
      bundleGraph.addBundleToBundleGroup(legacySiblingBundle, bundleGroup);
      //TODO Put this back for shared bundles
      // bundleGraph.createBundleReference(
      //   legacyMainBundleOfBundleGroup,
      //   legacySiblingBundle,
      // );
    }
  }

  /**
   * TODO: Create all bundles, bundlegroups,  without adding anything to them
   * Draw connections to bundles
   * Add references to bundles
   */
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
  // Asset to the bundle it's an entry of
  let bundleRoots: Map<BundleRoot, [NodeId, NodeId]> = new Map();
  let bundles: Map<string, NodeId> = new Map();
  let dependencyBundleGraph: DependencyBundleGraph = new ContentGraph();
  let assetReference: DefaultMap<
    Asset,
    Array<[Dependency, Bundle]>,
  > = new DefaultMap(() => []);
  //
  let reachableBundles: DefaultMap<
    BundleRoot,
    Set<BundleRoot>,
  > = new DefaultMap(() => new Set());
  //
  let bundleGraph: Graph<Bundle> = new Graph();
  let stack: Array<[BundleRoot, NodeId]> = [];
  let asyncBundleRootGraph: ContentGraph<
    BundleRoot | 'root',
  > = new ContentGraph();
  let bundleGroupBundleIds: Array<NodeId> = [];
  //TODO of asyncBundleRootGraph: we should either add a root node or use bundleGraph which has a root automatically

  // Step 1: Create bundles for each entry.
  // TODO: Try to not create bundles during this first path, only annotate
  //       BundleRoots
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
  asyncBundleRootGraph.setRootNodeId(rootNodeId);

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

    dependencyBundleGraph.addEdge(
      dependencyBundleGraph.addNodeByContentKeyIfNeeded(dependency.id, {
        value: dependency,
        type: 'dependency',
      }),
      dependencyBundleGraph.addNodeByContentKeyIfNeeded(String(nodeId), {
        value: bundle,
        type: 'bundle',
      }),
      dependency.priority,
    );
    bundleGroupBundleIds.push(nodeId);
  }

  let assets = [];
  // Traverse the asset graph and create bundles for asset type changes and async dependencies.
  // This only adds the entry asset of each bundle, not the subgraph.
  assetGraph.traverse({
    enter(node, context) {
      //Discover
      if (node.type === 'asset') {
        assets.push(node.value);

        let bundleIdTuple = bundleRoots.get(node.value);
        if (bundleIdTuple) {
          // Push to the stack when a new bundle is created.
          stack.push([node.value, bundleIdTuple[1]]); // TODO: switch this to be push/pop instead of unshift
        }
      } else if (node.type === 'dependency') {
        if (context == null) {
          return node;
        }

        let dependency = node.value;
        //TreeEdge Event
        invariant(context?.type === 'asset');
        let parentAsset = context.value;

        let assets = assetGraph.getDependencyAssets(dependency);
        if (assets.length === 0) {
          return node;
        }

        invariant(assets.length === 1);
        let childAsset = assets[0];

        // Create a new bundle as well as a new bundle group if the dependency is async.
        if (
          dependency.priority === 'lazy' ||
          childAsset.bundleBehavior === 'isolated'
        ) {
          // TODO: needsStableName if bundle exists here
          let bundleId = bundles.get(childAsset.id);
          let bundle;
          if (bundleId == null) {
            bundle = createBundle({
              asset: childAsset,
              target: nullthrows(bundleGraph.getNode(stack[0][1])).target,
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
          } else {
            bundle = nullthrows(bundleGraph.getNode(bundleId));
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
            dependency.priority,
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

            if (i === stack.length - 1) {
              //Add child and connection from parent to child bundleRoot
              let childNodeId = asyncBundleRootGraph.addNodeByContentKeyIfNeeded(
                childAsset.id,
                childAsset,
              );

              let parentNodeId = asyncBundleRootGraph.addNodeByContentKeyIfNeeded(
                stackAsset.id,
                stackAsset,
              );

              asyncBundleRootGraph.addEdge(parentNodeId, childNodeId);
            }
          }
          return node;
        }

        // Create a new bundle when the asset type changes.
        if (
          parentAsset.type !== childAsset.type ||
          childAsset.bundleBehavior === 'inline'
        ) {
          let [, bundleGroupNodeId] = nullthrows(stack[stack.length - 1]);
          let bundleGroup = nullthrows(bundleGraph.getNode(bundleGroupNodeId));
          let bundle = createBundle({
            asset: childAsset,
            target: bundleGroup.target,
            needsStableName: dependency.bundleBehavior === 'inline',
          });
          let bundleId = bundleGraph.addNode(bundle);
          bundles.set(childAsset.id, bundleId);
          bundleRoots.set(childAsset, [bundleId, bundleGroupNodeId]);

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
            'parallel',
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

  // Step 2: Determine reachability for every asset from each bundle root.
  // This is later used to determine which bundles to place each asset in.
  let reachableRoots: ContentGraph<Asset> = new ContentGraph();

  let reachableAsyncRoots: DefaultMap<NodeId, Set<BundleRoot>> = new DefaultMap(
    () => new Set(),
  );

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
            invariant(bundleRoots.has(bundleRoot));
            if (dependency.specifierType !== 'url') {
              reachableAsyncRoots
                .get(nullthrows(bundles.get(bundleRoot.id)))
                .add(root);
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

  // Step 2.5
  // IDEA 2: Somehow store all assets available (guarenteed to be loaded at this bundles load in time) at a certain point, for an asset/ bundleRoot, and do a lookup to
  // determine what MUST be duplicated.

  // PART 1 (located in STEP 1)
  // Make bundlegraph that models bundleRoots and async deps only [x]
  // Turn reachableRoots into graph so that we have sync deps (Bidirectional) [x]

  // PART 2
  // traverse PART 2 BundleGraph (BFS)
  // Maintain a MAP BundleRoot => Set of assets loaded thus far

  // At BundleRoot X
  // Peek/Ask for children [Z..]

  // get all assets guarenteed to be loaded when bundle X is loaded
  // map.set(Z, {all assets gurenteed to be loaded at this point (by ancestors (X))  INTERSECTION WITH current map.get(z) })

  //TODO Consider BUNDLEGRROUPS
  //Walk each bundlegroup entry
  //get each asset in the group (instead of syncassetsloaded)

  let ancestorAssets: Map<
    BundleRoot,
    Map<Asset, Array<BundleRoot> | null>,
  > = new Map();

  // Using Nested Maps, we need to be able to query, for a bundleGroup, an asset within that bundleGroup,
  // Any asset it "has", the ref when we first saw it
  //This is a triply nest map :o
  // AND we need a auxilary double map to keep current ref count for the next asset
  // (this can be just 1 map<asset=> num> because it will be reset when processing next bundleGroup )
  let assetRefsInBundleGroup: DefaultMap<
    BundleRoot,
    DefaultMap<Asset, number>,
  > = new DefaultMap(() => new DefaultMap(() => 0));
  //FOR BUNDLEGROUPS, hold each BUNDLEGROUPROOT mapped to Roots within the bundle root, mapped to assets available,
  // mapped to their number. We need duplicate entries
  for (let nodeId of asyncBundleRootGraph.topoSort()) {
    const bundleRoot = asyncBundleRootGraph.getNode(nodeId);
    if (bundleRoot === 'root') continue;
    invariant(bundleRoot != null);
    let ancestors = ancestorAssets.get(bundleRoot);

    //Get all assets available in this bundleRoot's bundleGroup through ideal graph
    //*****Bundle Group consideration start */
    let bundleGroupId = nullthrows(bundleRoots.get(bundleRoot))[1];
    //TODO should this include our bundle group root's assets
    let assetRefs = assetRefsInBundleGroup.get(bundleRoot);
    //Process all nodes within bundleGroup that are NOT isolated
    for (let bundleIdInGroup of [
      bundleGroupId,
      ...bundleGraph.getNodeIdsConnectedFrom(bundleGroupId),
    ]) {
      let bundleInGroup = nullthrows(bundleGraph.getNode(bundleIdInGroup)); //this is a bundle
      if (
        bundleInGroup.bundleBehavior === 'isolated' ||
        bundleInGroup.bundleBehavior === 'inline'
      ) {
        continue;
      }
      let [bundleRoot] = [...bundleInGroup.assets];

      let assetsFromBundleRoot = reachableRoots
        .getNodeIdsConnectedFrom(
          reachableRoots.getNodeIdByContentKey(bundleRoot.id),
        )
        .map(id => nullthrows(reachableRoots.getNode(id)));

      for (let asset of assetsFromBundleRoot) {
        assetRefs.set(asset, assetRefs.get(asset) + 1);
      }
    }

    //**********End of bundle Group consideration */
    //should we edit Combined to include what available in it's bundlegroup? -we aren't editing parent AA
    //THEN, process each ndoe in bundlegroup and do the same that we do below?
    let bundleGroupAssets = new Set(assetRefs.keys());

    let combined = ancestors
      ? new Map([...bundleGroupAssets, ...ancestors.keys()].map(a => [a, null])) //sync assets loaded should be all available assets at that moment (from anc bundle groups)
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
      ? ancestryUnion(new Set(ancestors.keys()), assetRefs, bundleRoot) //sync assets loaded should be all available assets at that moment (from anc bundle groups)
      : new Map([...bundleGroupAssets].map(a => [a, [bundleRoot]]));

    for (let bundleIdInGroup of bundleGraph.getNodeIdsConnectedFrom(
      bundleGroupId,
    )) {
      let bundleInGroup = bundleGraph.getNode(bundleIdInGroup); //this is a bundle
      invariant(bundleInGroup != null && bundleInGroup.assets != null);

      let [bundleRoot] = [...bundleInGroup.assets];

      const availableAssets = ancestorAssets.get(bundleRoot);

      if (availableAssets === undefined) {
        ancestorAssets.set(bundleRoot, siblingAncestors);
      } else {
        ancestryIntersect(availableAssets, siblingAncestors);
      }
    }
  }

  // Step 3: Place all assets into bundles. Each asset is placed into a single
  // bundle based on the bundle entries it is reachable from. This creates a
  // maximally code split bundle graph with no duplication.

  for (let asset of assets) {
    // Find bundle entries reachable from the asset.

    let reachable: Array<BundleRoot> = getReachableBundleRoots(
      asset,
      reachableRoots,
    ).reverse();

    // Filter out bundles when the asset is reachable in every parent bundle.
    // (Only keep a bundle if all of the others are not descendents of it)
    reachable = reachable.filter(b => {
      let ancestry = ancestorAssets.get(b)?.get(asset);
      if (ancestry === undefined) {
        return true;
      } else if (ancestry === null) {
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
    }); //don't want to filter out bundle if 'b' is not "reachable" from all of its (a) immediate parents
    // BundleRoot = Root Asset of a bundle
    // reachableRoots = any asset => all BundleRoots that require it synchronously
    // reachableBundles = Some BundleRoot => all BundleRoot decendants
    // reachable = all bundle root assets that cant always have that asset reliably on page (so they need to be pulled in by shared bundle or other)

    let rootBundle = bundleRoots.get(asset);
    if (
      rootBundle != null &&
      !nullthrows(bundleGraph.getNode(rootBundle[0])).env.isIsolated()
    ) {
      // If the asset is a bundle root, add the bundle to every other reachable bundle group.
      if (!bundles.has(asset.id)) {
        bundles.set(asset.id, rootBundle[0]);
      }

      for (let reachableAsset of reachable) {
        if (reachableAsset !== asset) {
          bundleGraph.addEdge(
            nullthrows(bundleRoots.get(reachableAsset))[1],
            rootBundle[0],
          );
        }
      }
      // reachableAsyncRoots = all bundleNodeId => all BundleRoots that require it asynchronously
      // reachableAsync = for one bundleRoot => all
      let reachableAsync = [
        ...(reachableAsyncRoots.has(rootBundle[0])
          ? reachableAsyncRoots.get(rootBundle[0])
          : []),
      ];
      // TODO: is this correct?
      let willInternalizeRoots = reachableAsync.filter(
        b =>
          !getReachableBundleRoots(asset, reachableRoots).every(
            a => !(a === b || reachableBundles.get(a).has(b)),
          ),
      );

      for (let bundleRoot of willInternalizeRoots) {
        if (bundleRoot !== asset) {
          let bundle = nullthrows(
            bundleGraph.getNode(nullthrows(bundles.get(bundleRoot.id))),
          );
          bundle.internalizedAssetIds.push(asset.id);
        }
      }
    } else if (reachable.length > 0) {
      // If the asset is reachable from more than one entry, find or create
      // a bundle for that combination of bundles (shared bundle), and add the asset to it.
      let sourceBundles = reachable.map(a => nullthrows(bundles.get(a.id)));
      let key = reachable.map(a => a.id).join(',');
      let bundleId = bundles.get(key);
      let bundle;
      if (bundleId == null) {
        let firstSourceBundle = nullthrows(
          bundleGraph.getNode(sourceBundles[0]),
        );
        bundle = createBundle({
          target: firstSourceBundle.target,
          type: firstSourceBundle.type,
          env: firstSourceBundle.env,
        });
        bundle.sourceBundles = sourceBundles;
        bundleId = bundleGraph.addNode(bundle);
        bundles.set(key, bundleId);
      } else {
        bundle = nullthrows(bundleGraph.getNode(bundleId));
      }
      bundle.assets.add(asset);
      bundle.size += asset.stats.size;

      // Add the bundle to each reachable bundle group.
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

  // Step 4: Merge any sibling bundles required by entry bundles back into the entry bundle.
  //         Entry bundles must be predictable, so cannot have unpredictable siblings.
  for (let [bundleNodeId, bundle] of bundleGraph.nodes) {
    if (bundle.sourceBundles.length > 0 && bundle.size < config.minBundleSize) {
      removeBundle(bundleGraph, bundleNodeId);
    }
  }

  for (let entryAsset of entries.keys()) {
    let entryBundleId = nullthrows(bundleRoots.get(entryAsset)?.[0]);
    let entryBundle = nullthrows(bundleGraph.getNode(entryBundleId));
    for (let siblingId of bundleGraph.getNodeIdsConnectedFrom(entryBundleId)) {
      let sibling = nullthrows(bundleGraph.getNode(siblingId));
      if (sibling.type !== entryBundle.type) {
        continue;
      }
      for (let asset of sibling.assets) {
        entryBundle.assets.add(asset);
        entryBundle.size += asset.stats.size;
      }
      bundleGraph.removeEdge(entryBundleId, siblingId);
      reachableAsyncRoots.get(siblingId).delete(entryAsset);
      if (sibling.sourceBundles.length > 1) {
        let entryBundleIndex = sibling.sourceBundles.indexOf(entryBundleId);
        invariant(entryBundleIndex >= 0);
        sibling.sourceBundles.splice(entryBundleIndex, 1);

        if (sibling.sourceBundles.length === 1) {
          let id = sibling.sourceBundles.pop();
          let bundle = nullthrows(bundleGraph.getNode(id));
          for (let asset of sibling.assets) {
            bundle.assets.add(asset);
            bundle.size += asset.stats.size;
          }
          bundleGraph.removeEdge(id, siblingId);
        }
      }
    }
  }

  for (let [asyncBundleRoot, dependentRoots] of reachableAsyncRoots) {
    if (dependentRoots.size === 0) {
      bundleGraph.removeNode(asyncBundleRoot);
    }
  }

  // $FlowFixMe
  dumpGraphToGraphViz(bundleGraph, 'IdealBundleGraph');

  return {
    bundleGraph,
    dependencyBundleGraph,
    bundleGroupBundleIds,
    entryBundles: [...bundleRoots.values()].map(v => v[0]),
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
    bundleBehavior: asset.bundleBehavior,
  };
}

function removeBundle(bundleGraph: Graph<Bundle>, bundleId: NodeId) {
  let bundle = nullthrows(bundleGraph.getNode(bundleId));

  for (let asset of bundle.assets) {
    for (let sourceBundleId of bundle.sourceBundles) {
      let sourceBundle = nullthrows(bundleGraph.getNode(sourceBundleId));
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
  ancestors: Set<Asset>,
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
  map: Map<Asset, Array<BundleRoot> | null>,
  previousMap: Map<Asset, Array<BundleRoot> | null>,
): void {
  for (let [asset, arrayOfBundleIds] of map) {
    if (previousMap.has(asset)) {
      let prevBundleIds = previousMap.get(asset);
      if (prevBundleIds) {
        if (arrayOfBundleIds) {
          arrayOfBundleIds.push(...prevBundleIds);
        } else {
          map.set(asset, [...prevBundleIds]);
        }
      }
    } else {
      map.delete(asset);
    }
  }
}

function getReachableBundleRoots(asset, graph): Array<BundleRoot> {
  return graph
    .getNodeIdsConnectedTo(graph.getNodeIdByContentKey(asset.id))
    .map(nodeId => nullthrows(graph.getNode(nodeId)));
}
