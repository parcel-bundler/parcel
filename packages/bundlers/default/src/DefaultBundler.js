// @flow strict-local

import type {
  Asset,
  Bundle as LegacyBundle,
  BundleGroup,
  Dependency,
  Config,
  MutableBundleGraph,
  PluginOptions,
} from '@parcel/types';
import type {NodeId} from '@parcel/core/src/types';
import type {SchemaEntity} from '@parcel/utils';

import Graph from '@parcel/core/src/Graph';
import dumpGraphToGraphViz from '@parcel/core/src/dumpGraphToGraphViz';

import invariant from 'assert';
import {Bundler} from '@parcel/plugin';
import {validateSchema, DefaultMap} from '@parcel/utils';
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

type BundleId = string;
type AssetId = string;
type Bundle = {|
  assetIds: Array<AssetId>,
  size: number,
  sourceBundles: Array<NodeId>,
|};
type BundleNode = {|
  id: BundleId,
  +type: 'mybundle',
  value: Bundle,
|};

type IdealGraph = {|
  dependencyLoadsBundle: Map<Dependency, NodeId>,
  bundleGraph: Graph<BundleNode>,
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

function decorateLegacyGraph(
  idealGraph: IdealGraph,
  bundleGraph: MutableBundleGraph,
): void {
  let idealBundleToLegacyBundle: Map<Bundle, LegacyBundle> = new Map();

  let {bundleGraph: idealBundleGraph, dependencyLoadsBundle} = idealGraph;
  let lastTarget;
  let dependencyToBundleGroup: Map<Dependency, BundleGroup> = new Map();
  for (let [dependency, bundleNodeId] of dependencyLoadsBundle) {
    let target = nullthrows(dependency.target ?? lastTarget);
    let bundleGroup = bundleGraph.createBundleGroup(dependency, target);
    if (dependency.target != null) {
      lastTarget = dependency.target;
    }

    // add the main bundle in the group
    let mainIdealBundle = nullthrows(idealBundleGraph.getNode(bundleNodeId))
      .value;
    let entryAsset = bundleGraph.getAssetById(mainIdealBundle.assetIds[0]);
    let mainBundle = bundleGraph.createBundle({
      entryAsset,
      target,
      needsStableName: dependency.isEntry,
    });
    idealBundleToLegacyBundle.set(mainIdealBundle, mainBundle);

    bundleGraph.addBundleToBundleGroup(mainBundle, bundleGroup);
  }

  for (let {value: bundle} of idealBundleGraph.nodes.values()) {
    let assets = bundle.assetIds.map(a => bundleGraph.getAssetById(a));

    for (let asset of assets) {
      bundleGraph.addAssetToBundle(
        asset,
        nullthrows(idealBundleToLegacyBundle.get(bundle)),
      );
    }
  }
}

function createIdealGraph(assetGraph: MutableBundleGraph): IdealGraph {
  // Asset to the bundle it's an entry of
  let bundleRoots: Map<Asset, [NodeId, NodeId]> = new Map();
  let dependencyLoadsBundle: Map<Dependency, NodeId> = new Map();
  //
  let reachableBundles: DefaultMap<Asset, Set<Asset>> = new DefaultMap(
    () => new Set(),
  );
  //
  let bundleGraph: Graph<BundleNode> = new Graph();
  //
  let stack: Array<[Asset, NodeId]> = [];

  // Step 1: Create bundles at the explicit split points in the graph.
  // Create bundles for each entry.
  let entries: Array<[Dependency, Asset]> = [];
  assetGraph.traverse((node, context, actions) => {
    if (node.type !== 'asset') {
      return node;
    }

    invariant(
      context != null && context.type === 'dependency' && context.value.isEntry,
    );
    entries.push([context.value, node.value]);
    actions.skipChildren();
  });

  for (let [dependency, asset] of entries) {
    let nodeId = bundleGraph.addNode(createBundleNode(createBundle(asset)));
    bundleRoots.set(asset, [nodeId, nodeId]);
    dependencyLoadsBundle.set(dependency, nodeId);
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
        invariant(assets.length === 1);
        let childAsset = assets[0];

        // Create a new bundle as well as a new bundle group if the dependency is async.
        if (
          dependency.priority === 'lazy' ||
          childAsset.bundleBehavior === 'isolated'
        ) {
          let bundleId = bundleGraph.addNode(
            createBundleNode(createBundle(childAsset)),
          );
          bundleRoots.set(childAsset, [bundleId, bundleId]);
          dependencyLoadsBundle.set(dependency, bundleId);

          // Walk up the stack until we hit a different asset type
          // and mark each bundle as reachable from every parent bundle
          for (let i = stack.length - 1; i >= 0; i--) {
            let [stackAsset] = stack[i];
            if (stackAsset.type !== childAsset.type) {
              break;
            }
            reachableBundles.get(stackAsset).add(childAsset);
          }
          return node;
        }

        // Create a new bundle when the asset type changes.
        if (parentAsset.type !== childAsset.type) {
          let [, bundleGroupNodeId] = nullthrows(stack[stack.length - 1]);
          let bundleId = bundleGraph.addNode(
            createBundleNode(createBundle(childAsset)),
          );
          bundleRoots.set(childAsset, [bundleId, bundleGroupNodeId]);

          // Add an edge from the bundle group entry to the new bundle.
          // This indicates that the bundle is loaded together with the entry
          bundleGraph.addEdge(bundleGroupNodeId, bundleId);
          return node;
        }
      }
      return node;
    },
    exit(node) {
      if (stack[stack.length - 1] === node.value) {
        stack.pop();
      }
    },
  });

  // Step 2: Determine reachability for every asset from each bundle root.
  // This is later used to determine which bundles to place each asset in.
  let reachableRoots: DefaultMap<Asset, Set<Asset>> = new DefaultMap(
    () => new Set(),
  );
  for (let [root] of bundleRoots) {
    assetGraph.traverse((node, _, actions) => {
      if (node.type !== 'asset') {
        return;
      }

      if (node.value === root) {
        return;
      }

      if (bundleRoots.has(node.value)) {
        actions.skipChildren();
        return;
      }
      reachableRoots.get(node.value).add(root);
    }, root);
  }

  // Step 3: Place all assets into bundles. Each asset is placed into a single
  // bundle based on the bundle entries it is reachable from. This creates a
  // maximally code split bundle graph with no duplication.

  // Create a mapping from entry asset ids to bundle ids

  //TODO Step 3, some mapping from multiple entry asset ids to a bundle Id
  let bundles: Map<string, NodeId> = new Map();
  for (let asset of assets) {
    // Find bundle entries reachable from the asset.
    let reachable = [...reachableRoots.get(asset)];

    // Filter out bundles when the asset is reachable in a parent bundle.
    reachable = reachable.filter(b =>
      reachable.every(a => !reachableBundles.get(a).has(b)),
    );

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
    } else if (reachable.length > 0) {
      // If the asset is reachable from more than one entry, find or create
      // a bundle for that combination of entries, and add the asset to it.
      let sourceBundles = reachable.map(a => nullthrows(bundles.get(a.id)));
      let key = reachable.map(a => a.id).join(',');

      let bundleId = bundles.get(key);
      if (bundleId == null) {
        let bundle = createBundle();
        bundle.sourceBundles = sourceBundles;
        bundleId = bundleGraph.addNode(createBundleNode(bundle));
        bundles.set(key, bundleId);
      }

      let bundle = nullthrows(bundleGraph.getNode(bundleId)).value;
      bundle.assetIds.push(asset.id);
      bundle.size += asset.stats.size;

      // Add the bundle to each reachable bundle group.
      for (let reachableAsset of reachable) {
        let reachableRoot = nullthrows(bundleRoots.get(reachableAsset))[1];
        if (reachableRoot !== bundleId) {
          bundleGraph.addEdge(reachableRoot, bundleId);
        }
      }
    }
  }

  // $FlowFixMe
  dumpGraphToGraphViz(bundleGraph, 'NewBundleGraph');

  return {bundleGraph, dependencyLoadsBundle};
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

function createBundle(asset?: Asset): Bundle {
  if (asset == null) {
    return {
      assetIds: [],
      size: 0,
      sourceBundles: [],
    };
  }

  return {
    assetIds: [asset.id],
    size: asset.stats.size,
    sourceBundles: [],
  };
}

function createBundleNode(bundle: Bundle): BundleNode {
  return {
    id: '',
    type: 'mybundle',
    value: bundle,
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
