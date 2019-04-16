// @flow strict-local

import type AssetGraph from './AssetGraph';
import type {FilePath, Namer, ParcelOptions, RuntimeAsset} from '@parcel/types';
import type {Bundle as InternalBundle} from './types';
import type Config from './Config';

import nullthrows from 'nullthrows';
import BundleGraph from './public/BundleGraph';
import InternalBundleGraph from './BundleGraph';
import MainAssetGraph from './public/MainAssetGraph';
import {Bundle, FulfilledBundle} from './public/Bundle';
import AssetGraphBuilder from './AssetGraphBuilder';
import {report} from './ReporterRunner';
import {getBundleGroupId} from './public/utils';

type Opts = {|
  options: ParcelOptions,
  config: Config,
  rootDir: FilePath
|};

export default class BundlerRunner {
  options: ParcelOptions;
  config: Config;
  rootDir: FilePath;

  constructor(opts: Opts) {
    this.options = opts.options;
    this.config = opts.config;
    this.rootDir = opts.rootDir;
  }

  async bundle(graph: AssetGraph): Promise<InternalBundleGraph> {
    report({
      type: 'buildProgress',
      phase: 'bundling'
    });

    let bundler = await this.config.getBundler();

    let bundleGraph = new InternalBundleGraph();
    await bundler.bundle(
      new MainAssetGraph(graph),
      new BundleGraph(bundleGraph),
      this.options
    );
    await this.nameBundles(bundleGraph);
    await this.applyRuntimes(bundleGraph);

    return bundleGraph;
  }

  async nameBundles(bundleGraph: InternalBundleGraph): Promise<void> {
    let namers = await this.config.getNamers();
    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      promises.push(this.nameBundle(namers, bundle));
    });

    await Promise.all(promises);
  }

  async nameBundle(
    namers: Array<Namer>,
    internalBundle: InternalBundle
  ): Promise<void> {
    let bundle = new Bundle(internalBundle);
    for (let namer of namers) {
      let filePath = await namer.name(bundle, {
        rootDir: this.rootDir
      });

      if (filePath != null) {
        internalBundle.filePath = filePath;
        return;
      }
    }

    throw new Error('Unable to name bundle');
  }

  async applyRuntimes(bundleGraph: InternalBundleGraph): Promise<void> {
    let bundles = [];
    bundleGraph.traverseBundles(bundle => {
      bundles.push(new FulfilledBundle(bundle));
    });

    for (let bundle of bundles) {
      let runtimes = await this.config.getRuntimes(bundle.env.context);
      for (let runtime of runtimes) {
        let applied = await runtime.apply(bundle, this.options);
        if (applied) {
          await this.addRuntimesToBundle(
            bundle.id,
            bundleGraph,
            Array.isArray(applied) ? applied : [applied]
          );
        }
      }
    }
  }

  async addRuntimesToBundle(
    bundleId: string,
    bundleGraph: InternalBundleGraph,
    runtimeAssets: Array<RuntimeAsset>
  ) {
    let node = bundleGraph.nodes.get(bundleId);
    if (node == null) {
      throw new Error('Bundle not found');
    }
    if (node.type !== 'bundle') {
      throw new Error('Not a bundle id');
    }
    let bundle = node.value;

    for (let {code, filePath, bundleGroup} of runtimeAssets) {
      let builder = new AssetGraphBuilder({
        options: this.options,
        config: this.config,
        rootDir: this.rootDir,
        transformerRequest: {
          code,
          filePath,
          env: bundle.env
        }
      });

      // build a graph of just the transformed asset
      let graph = await builder.build();

      let entry = graph.getEntryAssets()[0];
      let subGraph = graph.getSubGraph(nullthrows(graph.getNode(entry.id)));

      // Exclude modules that are already included in an ancestor bundle
      subGraph.traverseAssets(asset => {
        if (bundleGraph.isAssetInAncestorBundle(bundle, asset)) {
          subGraph.removeAsset(asset);
        }
      });

      // merge the transformed asset into the bundle's graph, and connect
      // the node to it.
      bundle.assetGraph.merge(subGraph);

      bundle.assetGraph.addEdge({
        from: bundleGroup
          ? getBundleGroupId(bundleGroup)
          : nullthrows(bundle.assetGraph.getRootNode()).id,
        to: entry.id
      });
    }
  }
}
