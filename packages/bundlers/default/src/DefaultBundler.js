// @flow strict-local

import type {
  Asset,
  BundleGroup,
  Config,
  MutableBundleGraph,
  PluginOptions,
} from '@parcel/types';
import type {NodeId} from '@parcel/core/src/types';
import type {SchemaEntity} from '@parcel/utils';

import Graph from '@parcel/core/src/Graph';

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
  +type: '',
  value: Bundle,
|};

export default (new Bundler({
  loadConfig({config, options}) {
    return loadBundlerConfig(config, options);
  },

  bundle({bundleGraph: assetGraph, config}) {
    //assetgraph here is a MutableBundleGraph

    let bundleRoots: Map<Asset, [NodeId, NodeId]> = new Map(); //asset to tuple of bundle Ids
    let reachableBundles: Map<Bundle, Set<Bundles>> = new Map();

    let bundleGraph: Graph<BundleNode> = new Graph();

    let stack: Array<[AssetId, NodeId]> = [];

    // Step 1: Create bundles at the explicit split points in the graph.
    // Create bundles for each entry.
    let entries: Array<Asset> = [];
    assetGraph.traverse((node, context, actions) => {
      if (node.type !== 'asset') {
        return node;
      }

      invariant(
        context != null &&
          context.type === 'dependency' &&
          context.value.isEntry,
      );
      entries.push(node.value);
      actions.skipChildren();
    });
    // console.log(
    //   'entries are',
    //   entries.map(value => value.filePath),
    // );

    for (let entry of entries) {
      let nodeId = bundleGraph.addNode(createBundleNode(createBundle(entry)));
      bundleRoots.set(entry, [nodeId, nodeId]);
    }
    // Traverse the asset graph and create bundles for asset type changes and async dependencies.
    // This only adds the entry asset of each bundle, not the subgraph.
    assetGraph.traverse({
      enter(node, context, actions) {
        //Discover
        if (node.type === 'asset') {
          let bundleIdTuple = bundleRoots.get(node.value);
          if (bundleIdTuple) {
            // Push to the stack when a new bundle is created.
            stack.unshift([node.value.id, bundleIdTuple[1]]); // TODO: switch this to be push/pop instead of unshift
          }
        } else if (node.type === 'dependency') {
          let dependency = node.value;
          //TreeEdge Event
          invariant(context?.type === 'asset');
          let parentAsset = context.value;

          let assets = assetGraph.getDependencyAssets(dependency);
          invariant(assets.length === 1);
          let childAsset = assets[0];

          // Create a new bundle when the asset type changes.
          if (parentAsset.type !== childAsset.type) {
            let [_, bundleGroupNodeId] = nullthrows(stack[0]);
            let bundleId = bundleGraph.addNode(
              createBundleNode(createBundle(childAsset)),
            );
            bundleRoots.set(childAsset, [bundleId, bundleGroupNodeId]);

            // Add an edge from the bundle group entry to the new bundle.
            // This indicates that the bundle is loaded together with the entry
            bundleGraph.addEdge(bundleGroupNodeId, bundleId);
            return node;
          }
          // Create a new bundle as well as a new bundle group if the dependency is async.
          // TODO: add create new bundlegroup on async deps
        }
        return node;
      },
      exit(node, context, actions) {
        if (stack[0] === node.value) {
          stack.shift();
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

        if (bundleRoots.has(root)) {
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

    let bundles: Map<string, BundleId> = new Map();
    //TODO Step 3, some mapping from multiple entry asset ids to a bundle Id
  },
  optimize() {},
}): Bundler);

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

function createBundle(asset: Asset): Bundle {
  return {
    assetIds: [asset.id],
    size: asset.stats.size,
    sourceBundles: [],
  };
}

function createBundleNode(bundle: Bundle): BundleNode {
  return {
    id: '',
    type: '',
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
