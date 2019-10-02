// @flow strict-local

import type {Dependency, Namer} from '@parcel/types';
import type {
  AssetNode,
  AssetRequest,
  Bundle as InternalBundle,
  DependencyNode,
  ParcelOptions,
  NodeId,
  RootNode
} from './types';
import type ParcelConfig from './ParcelConfig';
import type WorkerFarm from '@parcel/workers';
import type RequestGraph from './RequestGraph';

import assert from 'assert';
import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import AssetGraph, {nodeFromAssetGroup} from './AssetGraph';
import BundleGraph from './public/BundleGraph';
import InternalBundleGraph from './BundleGraph';
import Graph from './Graph';
import MutableBundleGraph from './public/MutableBundleGraph';
import {Bundle, NamedBundle} from './public/Bundle';
import AssetGraphBuilder from './AssetGraphBuilder';
import {report} from './ReporterRunner';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';
import {
  normalizeSeparators,
  setDifference,
  unique,
  md5FromObject
} from '@parcel/utils';
import PluginOptions from './public/PluginOptions';

type Opts = {|
  options: ParcelOptions,
  config: ParcelConfig,
  workerFarm: WorkerFarm
|};

export default class BundlerRunner {
  options: ParcelOptions;
  config: ParcelConfig;
  pluginOptions: PluginOptions;
  farm: WorkerFarm;
  priorRuntimeGraphs: ?{|
    assetGraph: AssetGraph,
    requestGraph: RequestGraph
  |};

  constructor(opts: Opts) {
    this.options = opts.options;
    this.config = opts.config;
    this.pluginOptions = new PluginOptions(this.options);
    this.farm = opts.workerFarm;
  }

  async bundle(graph: AssetGraph): Promise<InternalBundleGraph> {
    report({
      type: 'buildProgress',
      phase: 'bundling'
    });

    let cacheKey;
    if (!this.options.disableCache) {
      cacheKey = await this.getCacheKey(graph);
      let cachedBundleGraph = await this.options.cache.get(cacheKey);
      if (cachedBundleGraph) {
        return cachedBundleGraph;
      }
    }

    let bundler = await this.config.getBundler();

    let bundleGraph = removeAssetGroups(graph);
    // $FlowFixMe
    let internalBundleGraph = new InternalBundleGraph({graph: bundleGraph});
    await dumpGraphToGraphViz(bundleGraph, 'before_bundle');
    let mutableBundleGraph = new MutableBundleGraph(
      internalBundleGraph,
      this.options
    );
    await bundler.bundle({
      bundleGraph: mutableBundleGraph,
      options: this.pluginOptions
    });
    await dumpGraphToGraphViz(bundleGraph, 'after_bundle');
    await bundler.optimize({
      bundleGraph: mutableBundleGraph,
      options: this.pluginOptions
    });
    await dumpGraphToGraphViz(bundleGraph, 'after_optimize');
    await this.nameBundles(internalBundleGraph);
    this.priorRuntimeGraphs = await this.applyRuntimes(
      internalBundleGraph,
      this.priorRuntimeGraphs
    );
    await dumpGraphToGraphViz(bundleGraph, 'after_runtimes');

    if (cacheKey != null) {
      await this.options.cache.set(cacheKey, internalBundleGraph);
    }

    return internalBundleGraph;
  }

  async getCacheKey(assetGraph: AssetGraph) {
    let bundler = this.config.bundler;
    let {pkg} = await this.options.packageManager.resolve(
      `${bundler}/package.json`,
      `${this.config.filePath}/index` // TODO: is this right?
    );

    let version = nullthrows(pkg).version;
    return md5FromObject({
      bundler,
      version,
      hash: assetGraph.getHash()
    });
  }

  async nameBundles(bundleGraph: InternalBundleGraph): Promise<void> {
    let namers = await this.config.getNamers();
    let bundles = bundleGraph.getBundles();

    await Promise.all(
      bundles.map(bundle => this.nameBundle(namers, bundle, bundleGraph))
    );

    let bundlePaths = bundles.map(b => b.filePath);
    assert.deepEqual(
      bundlePaths,
      unique(bundlePaths),
      'Bundles must have unique filePaths'
    );
  }

  async nameBundle(
    namers: Array<Namer>,
    internalBundle: InternalBundle,
    internalBundleGraph: InternalBundleGraph
  ): Promise<void> {
    let bundle = new Bundle(internalBundle, internalBundleGraph, this.options);
    let bundleGraph = new BundleGraph(internalBundleGraph, this.options);

    for (let namer of namers) {
      let name = await namer.name({
        bundle,
        bundleGraph,
        options: this.pluginOptions
      });

      if (name != null) {
        if (path.extname(name).slice(1) !== bundle.type) {
          throw new Error(
            `Destination name ${name} extension does not match bundle type "${
              bundle.type
            }"`
          );
        }

        let target = nullthrows(internalBundle.target);
        internalBundle.filePath = path.join(
          target.distDir,
          normalizeSeparators(name)
        );
        internalBundle.name = name;
        return;
      }
    }

    throw new Error('Unable to name bundle');
  }

  async applyRuntimes(
    bundleGraph: InternalBundleGraph,
    priorGraphs: ?{|
      assetGraph: AssetGraph,
      requestGraph: RequestGraph
    |}
  ): Promise<{|assetGraph: AssetGraph, requestGraph: RequestGraph|}> {
    let tuples: Array<{|
      bundle: InternalBundle,
      assetRequest: AssetRequest,
      dependency: ?Dependency,
      isEntry: ?boolean
    |}> = [];

    for (let bundle of bundleGraph.getBundles()) {
      let runtimes = await this.config.getRuntimes(bundle.env.context);
      for (let runtime of runtimes) {
        let applied = await runtime.apply({
          bundle: new NamedBundle(bundle, bundleGraph, this.options),
          bundleGraph: new BundleGraph(bundleGraph, this.options),
          options: this.pluginOptions
        });

        if (applied) {
          let runtimeAssets = Array.isArray(applied) ? applied : [applied];
          for (let {code, dependency, filePath, isEntry} of runtimeAssets) {
            let assetRequest = {
              code,
              filePath,
              env: bundle.env
            };
            tuples.push({
              bundle,
              assetRequest,
              dependency: dependency,
              isEntry
            });
          }
        }
      }
    }

    let assetGraph, requestGraph;
    if (priorGraphs && priorGraphs.assetGraph == null) {
      let builder = new AssetGraphBuilder();
      await builder.init({
        options: this.options,
        config: this.config,
        assetRequests: tuples.map(t => t.assetRequest),
        workerFarm: this.farm
      });

      // build a graph of all of the runtime assets
      assetGraph = (await builder.build()).assetGraph;
      requestGraph = builder.requestGraph;
    } else {
      invariant(priorGraphs != null);
      invariant(priorGraphs.requestGraph != null);
      assetGraph = priorGraphs.assetGraph;
      requestGraph = priorGraphs.requestGraph;

      let assetRequestsById = new Map(
        tuples
          .map(t => t.assetRequest)
          .map(request => [nodeFromAssetGroup(request).id, request])
      );
      let newRequestIds = new Set(assetRequestsById.keys());
      let oldRequestIds = new Set(
        assetGraph.getEntryAssets().map(asset => {
          let inboundNodes = assetGraph.getNodesConnectedTo(
            nullthrows(assetGraph.getNode(asset.id))
          );
          invariant(
            inboundNodes.length === 1 && inboundNodes[0].type === 'asset_group'
          );
          return inboundNodes[0].id;
        })
      );

      let toAdd = setDifference(newRequestIds, oldRequestIds);
      let toRemove = setDifference(oldRequestIds, newRequestIds);

      for (let requestId of toAdd) {
        requestGraph.addAssetRequest(
          requestId,
          nullthrows(assetRequestsById.get(requestId))
        );
      }
      for (let requestId of toRemove) {
        assetGraph.removeById(requestId);
      }
    }

    let runtimesGraph = removeAssetGroups(assetGraph);

    // merge the transformed asset into the bundle's graph, and connect
    // the node to it.
    // $FlowFixMe
    bundleGraph._graph.merge(runtimesGraph);

    for (let {bundle, assetRequest, dependency, isEntry} of tuples) {
      let assetGroupNode = nodeFromAssetGroup(assetRequest);
      let assetGroupAssets = assetGraph.getNodesConnectedFrom(assetGroupNode);
      invariant(assetGroupAssets.length === 1);
      let runtimeNode = assetGroupAssets[0];
      invariant(runtimeNode.type === 'asset');

      let duplicatedAssetIds: Set<NodeId> = new Set();
      runtimesGraph.traverse((node, _, actions) => {
        if (node.type !== 'dependency') {
          return;
        }

        let assets = runtimesGraph
          .getNodesConnectedFrom(node)
          .map(assetNode => {
            invariant(assetNode.type === 'asset');
            return assetNode.value;
          });

        for (let asset of assets) {
          if (bundleGraph.isAssetInAncestorBundles(bundle, asset)) {
            duplicatedAssetIds.add(asset.id);
            actions.skipChildren();
          }
        }
      }, runtimeNode);

      runtimesGraph.traverse((node, _, actions) => {
        if (node.type === 'asset' || node.type === 'dependency') {
          if (duplicatedAssetIds.has(node.id)) {
            actions.skipChildren();
            return;
          }

          bundleGraph._graph.addEdge(bundle.id, node.id, 'contains');
        }
      }, runtimeNode);

      bundleGraph._graph.addEdge(
        dependency
          ? dependency.id
          : nullthrows(bundleGraph._graph.getNode(bundle.id)).id,
        runtimeNode.id
      );

      if (isEntry) {
        bundle.entryAssetIds.unshift(runtimeNode.id);
      }
    }

    return {assetGraph, requestGraph};
  }
}

function removeAssetGroups(
  assetGraph: AssetGraph
): Graph<AssetNode | DependencyNode | RootNode> {
  let graph = new Graph<AssetNode | DependencyNode | RootNode>();
  // $FlowFixMe
  graph.setRootNode(nullthrows(assetGraph.getRootNode()));
  let assetGroupIds = new Set();

  assetGraph.traverse(node => {
    if (node.type === 'asset_group') {
      assetGroupIds.add(node.id);
    } else {
      graph.addNode(node);
    }
  });

  for (let edge of assetGraph.getAllEdges()) {
    let fromIds;
    if (assetGroupIds.has(edge.from)) {
      fromIds = [...assetGraph.inboundEdges.get(edge.from).get(null)];
    } else {
      fromIds = [edge.from];
    }

    for (let from of fromIds) {
      if (assetGroupIds.has(edge.to)) {
        for (let to of assetGraph.outboundEdges.get(edge.to).get(null)) {
          graph.addEdge(from, to);
        }
      } else {
        graph.addEdge(from, edge.to);
      }
    }
  }

  return graph;
}
