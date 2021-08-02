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
import {
  validateSchema,
  DefaultMap,
  setIntersection,
  setUnion,
} from '@parcel/utils';
import {hashString} from '@parcel/hash';
import nullthrows from 'nullthrows';
import {encodeJSONKeyComponent} from '@parcel/diagnostic';

type BundlerConfig = {|
  http?: number,
  minBundles?: number,
  minBundleSize?: number,
  maxParallelRequests?: number,
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
  assetIds: Array<AssetId>,
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
  entryBundles: Array<NodeId>,
  assetReference: DefaultMap<Asset, Array<[Dependency, Bundle]>>,
|};

export default (new Bundler({
  loadConfig({config, options}) {
    return loadBundlerConfig(config, options);
  },

  bundle({bundleGraph, config}) {
    decorateLegacyGraph(createIdealGraph(bundleGraph), bundleGraph);
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

  let {bundleGraph: idealBundleGraph, dependencyBundleGraph} = idealGraph;
  let entryBundleToBundleGroup: Map<NodeId, BundleGroup> = new Map();

  for (let [bundleNodeId, idealBundle] of idealBundleGraph.nodes) {
    let dependencies = dependencyBundleGraph
      .getNodeIdsConnectedTo(
        dependencyBundleGraph.getNodeIdByContentKey(String(bundleNodeId)),
        ['lazy', 'sync'],
      )
      .map(nodeId => {
        let dependency = nullthrows(dependencyBundleGraph.getNode(nodeId));
        invariant(dependency.type === 'dependency');
        return dependency.value;
      });
    console.log('deps are', dependencies);
    let entryAsset = bundleGraph.getAssetById(idealBundle.assetIds[0]);
    // This entry asset is the first asset of the bundle (not entry file asset)
    let bundleGroup;
    let bundle;

    if (dependencies && dependencies.length > 0) {
      //console.log('deps are', dependencies);
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
            idealBundle.assetIds.join(',') +
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

    let assets = idealBundle.assetIds.map(a => bundleGraph.getAssetById(a));

    for (let asset of assets) {
      bundleGraph.addAssetToBundle(asset, bundle);
    }

    //console.log('INTERNALIZED', idealBundle.internalizedAssetIds);
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
          //console.log('INTERNALIZING DEP', incomingDep);
          bundleGraph.internalizeAsyncDependency(bundle, incomingDep);
        } else {
          // console.log(
          //   'NOT INTERNALIZING DEP',
          //   incomingDep,
          //   incomingDep.priority,
          //   bundle.hasDependency(incomingDep),
          // );
        }
      }
    }
  }

  for (let [bundleId, bundleGroup] of entryBundleToBundleGroup) {
    let outboundNodeIds = idealBundleGraph.getNodeIdsConnectedFrom(bundleId);
    let mainBundleOfBundleGroup = nullthrows(
      idealBundleGraph.getNode(bundleId),
    );
    let legacyMainBundleOfBundleGroup = nullthrows(
      idealBundleToLegacyBundle.get(mainBundleOfBundleGroup),
    );

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

function createIdealGraph(assetGraph: MutableBundleGraph): IdealGraph {
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
          // TODO: This bundle can be "created" by multiple dependencies?
          let bundleId = bundles.get(childAsset.id);
          if (bundleId == null) {
            let bundle = createBundle({
              asset: childAsset,
              target: nullthrows(bundleGraph.getNode(stack[0][1])).target,
            });
            bundleId = bundleGraph.addNode(bundle);
            bundles.set(childAsset.id, bundleId);
            bundleRoots.set(childAsset, [bundleId, bundleId]);

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
          }
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
        if (dependencyBundleGraph.hasContentKey(node.value.id)) {
          if (node.value.priority === 'lazy') {
            let assets = assetGraph.getDependencyAssets(node.value);
            if (assets.length === 0) {
              return node;
            }

            invariant(assets.length === 1);
            let bundleRoot = assets[0];
            invariant(bundleRoots.has(bundleRoot));

            reachableAsyncRoots
              .get(nullthrows(bundles.get(bundleRoot.id)))
              .add(root);
          }
          actions.skipChildren();
          return;
        }
        // TODO Handle other situations in which bundles are created and maybe
        // centralize that in a function
        // if (isABundleRoot and dependency is not sync) {
        // if (node.value.priority === 'lazy') {
        //   let assets = assetGraph.getDependencyAssets(node.value);
        //   if (assets.length === 0) {
        //     return node;
        //   }

        //   invariant(assets.length === 1);
        //   let bundleRoot = assets[0];
        //   invariant(bundleRoots.has(bundleRoot));

        //   reachableAsyncRoots
        //     .get(nullthrows(bundles.get(bundleRoot.id)))
        //     .add(root);
        //   actions.skipChildren();
        //}
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

  let ancestorAssets: Map<BundleRoot, Set<Asset>> = new Map();
  //set difference  //Map<C, [A, common]>
  //console.log('toposort:', asyncBundleRootGraph.topoSort());
  for (let nodeId of asyncBundleRootGraph.topoSort()) {
    let bundleRoot = asyncBundleRootGraph.getNode(nodeId);
    if (bundleRoot === 'root') continue;
    invariant(bundleRoot != null);

    let syncAssetsLoaded = reachableRoots
      .getNodeIdsConnectedFrom(
        reachableRoots.getNodeIdByContentKey(bundleRoot.id),
      )
      .map(id => nullthrows(reachableRoots.getNode(id))); //assets synchronously loaded when a is loaded

    //console.log({syncAssetsLoaded});

    let ancestors = ancestorAssets.get(bundleRoot);

    let combined = ancestors
      ? setUnion(ancestors, syncAssetsLoaded)
      : new Set(syncAssetsLoaded);
    let children = asyncBundleRootGraph.getNodeIdsConnectedFrom(nodeId);
    //console.log({children});

    for (let childId of children) {
      let child = asyncBundleRootGraph.getNode(childId);
      invariant(child !== 'root' && child != null);
      const availableAssets = ancestorAssets.get(child);

      if (availableAssets == null) {
        ancestorAssets.set(child, combined);
      } else if (
        asyncBundleRootGraph.getNodeIdsConnectedTo(childId).length > 1
      ) {
        ancestorAssets.set(child, setIntersection(combined, availableAssets));
        //console.log({combined});
      } else {
        ancestorAssets.set(child, setUnion(combined, availableAssets));
      }
    }
  }

  //console.log(ancestorAssets);
  // Step 3: Place all assets into bundles. Each asset is placed into a single
  // bundle based on the bundle entries it is reachable from. This creates a
  // maximally code split bundle graph with no duplication.

  for (let asset of assets) {
    // Find bundle entries reachable from the asset.
    let reachable: Array<BundleRoot> = getReachableBundleRoots(
      asset,
      reachableRoots,
    );

    //console.log('Reachable before for', asset.filePath, 'is ', reachable);
    // Filter out bundles when the asset is reachable in every parent bundle.
    // (Only keep a bundle if all of the others are not descendents of it)
    reachable = reachable.filter(b => !ancestorAssets.get(b)?.has(asset)); //don't want to filter out bundle if 'b' is not "reachable" from all of its (a) immediate parents

    //console.log('Reachable for', asset.filePath, 'is ', reachable);
    //IDEA: reachableBundles as a graph so we can query an assets ancestors and/or decendants

    // BundleRoot = Root Asset of a bundle
    // reachableRoots = any asset => all BundleRoots that require it synchronously
    // reachableBundles = Some BundleRoot => all BundleRoot decendants
    // reachable = all bundle root assets that cant always have that asset reliably on page (so they need to be pulled in by shared bundle or other)

    let rootBundle = bundleRoots.get(asset);
    if (rootBundle != null) {
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
          // console.log(
          //   'PUSHING',
          //   asset.id,
          //   'into bundle',
          //   nullthrows(bundles.get(bundleRoot.id)),
          // );
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
        console.log('creating shared bundle ', bundleId);
      } else {
        bundle = nullthrows(bundleGraph.getNode(bundleId));
      }
      bundle.assetIds.push(asset.id);
      bundle.size += asset.stats.size;

      // Add the bundle to each reachable bundle group.
      for (let sourceBundleId of sourceBundles) {
        console.log('bundle id', bundleId, 'and source id is', sourceBundleId);
        bundleGraph.addEdge(sourceBundleId, bundleId);
      }
    }
  }
  dumpGraphToGraphViz(bundleGraph, 'IdealBundleGraph');
  // Step 4: Merge any sibling bundles required by entry bundles back into the entry bundle.
  //         Entry bundles must be predictable, so cannot have unpredictable siblings.
  for (let entryAsset of entries.keys()) {
    let entryBundleId = nullthrows(bundleRoots.get(entryAsset)?.[0]);
    let entryBundle = nullthrows(bundleGraph.getNode(entryBundleId));
    for (let siblingId of bundleGraph.getNodeIdsConnectedFrom(entryBundleId)) {
      let sibling = nullthrows(bundleGraph.getNode(siblingId));
      console.log(
        'Sibling type is ',
        sibling.type,
        'sib id is',
        siblingId,
        'and entry type is',
        entryBundle.type,
        'id: ',
        entryBundleId,
      );
      if (sibling.type !== entryBundle.type) {
        continue;
      }

      for (let assetId of sibling.assetIds) {
        entryBundle.assetIds.push(assetId);
      }
      console.log('Removing edge from', entryBundleId, 'to ', siblingId);
      bundleGraph.removeEdge(entryBundleId, siblingId);
      reachableAsyncRoots.get(siblingId).delete(entryAsset);
      if (sibling.sourceBundles.length > 1) {
        let entryBundleIndex = sibling.sourceBundles.indexOf(entryBundleId);
        invariant(entryBundleIndex >= 0);
        sibling.sourceBundles.splice(entryBundleIndex, 1);

        if (sibling.sourceBundles.length === 1) {
          let id = sibling.sourceBundles.pop();
          let bundle = nullthrows(bundleGraph.getNode(id));
          for (let assetId of sibling.assetIds) {
            bundle.assetIds.push(assetId);
          }
          console.log('Removing edge from', id, 'to ', siblingId);
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
  for (let [nodeId, node] of asyncBundleRootGraph.nodes) {
    //console.log('node id is', nodeId, 'and node is', node);
    for (let otherNode of asyncBundleRootGraph.getNodeIdsConnectedFrom(
      nodeId,
    )) {
      //console.log('Edge from ', nodeId, ' to ', otherNode);
    }
  }
  return {
    bundleGraph,
    dependencyBundleGraph,
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
      |}
    | {|
        target: Target,
        asset: Asset,
        env?: Environment,
        type?: string,
        needsStableName?: boolean,
      |},
): Bundle {
  if (opts.asset == null) {
    return {
      assetIds: [],
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
    assetIds: [asset.id],
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

async function loadBundlerConfig(config: Config, options: PluginOptions) {
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
