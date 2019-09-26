// @flow strict-local

import type {Namer, RuntimeAsset} from '@parcel/types';
import type {
  Bundle as InternalBundle,
  ParcelOptions,
  BundleGraphNode
} from './types';
import type ParcelConfig from './ParcelConfig';
import type WorkerFarm from '@parcel/workers';

import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import AssetGraph from './AssetGraph';
import BundleGraph from './public/BundleGraph';
import InternalBundleGraph from './BundleGraph';
import Graph from './Graph';
import MutableBundleGraph from './public/MutableBundleGraph';
import {Bundle, NamedBundle} from './public/Bundle';
import AssetGraphBuilder from './AssetGraphBuilder';
import {report} from './ReporterRunner';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';
import {normalizeSeparators, unique, md5FromObject} from '@parcel/utils';
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
    await this.applyRuntimes(internalBundleGraph);
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

  async applyRuntimes(internalBundleGraph: InternalBundleGraph): Promise<void> {
    for (let bundle of internalBundleGraph.getBundles()) {
      let runtimes = await this.config.getRuntimes(bundle.env.context);
      for (let runtime of runtimes) {
        let applied = await runtime.apply({
          bundle: new NamedBundle(bundle, internalBundleGraph, this.options),
          bundleGraph: new BundleGraph(internalBundleGraph, this.options),
          options: this.pluginOptions
        });
        if (applied) {
          internalBundleGraph._bundleContentHashes.delete(bundle.id);
          await this.addRuntimesToBundle(
            bundle,
            internalBundleGraph,
            Array.isArray(applied) ? applied : [applied]
          );
        }
      }
    }
  }

  async addRuntimesToBundle(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    runtimeAssets: Array<RuntimeAsset>
  ) {
    for (let {code, filePath, dependency, isEntry} of runtimeAssets) {
      let builder = new AssetGraphBuilder();
      await builder.init({
        options: this.options,
        config: this.config,
        assetRequest: {
          code,
          filePath,
          env: bundle.env
        },
        workerFarm: this.farm
      });

      // build a graph of just the transformed asset
      let {assetGraph} = await builder.build();

      let entry = assetGraph.getEntryAssets()[0];
      let subBundleGraph = new InternalBundleGraph({
        // $FlowFixMe
        graph: removeAssetGroups(
          assetGraph.getSubGraph(nullthrows(assetGraph.getNode(entry.id)))
        )
      });

      // Exclude modules that are already included in an ancestor bundle
      let duplicated = [];
      subBundleGraph.traverseContents((node, _, actions) => {
        if (node.type !== 'dependency') {
          return;
        }

        let dependency = node.value;
        let assets = subBundleGraph.getDependencyAssets(dependency);

        for (let asset of assets) {
          if (bundleGraph.isAssetInAncestorBundles(bundle, asset)) {
            duplicated.push(asset);
            actions.skipChildren();
          }
        }
      });

      // merge the transformed asset into the bundle's graph, and connect
      // the node to it.
      // $FlowFixMe
      bundleGraph._graph.merge(subBundleGraph._graph);
      subBundleGraph._graph.traverse(node => {
        if (node.type === 'asset' || node.type === 'dependency') {
          bundleGraph._graph.addEdge(bundle.id, node.id, 'contains');
        }
      });

      for (let asset of duplicated) {
        bundleGraph.removeAssetGraphFromBundle(asset, bundle);
      }

      bundleGraph._graph.addEdge(
        dependency
          ? dependency.id
          : nullthrows(bundleGraph._graph.getNode(bundle.id)).id,
        entry.id
      );

      if (isEntry) {
        bundle.entryAssetIds.unshift(entry.id);
      }
    }
  }
}

function removeAssetGroups(assetGraph: AssetGraph): Graph<BundleGraphNode> {
  let graph = new Graph<BundleGraphNode>();
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
