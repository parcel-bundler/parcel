// @flow strict-local

import type AssetGraph from './AssetGraph';
import type {
  Asset,
  Bundle,
  FilePath,
  Namer,
  ParcelOptions,
  TransformerRequest
} from '@parcel/types';
import type Config from './Config';

import nullthrows from 'nullthrows';
import BundleGraph from './BundleGraph';
import AssetGraphBuilder from './AssetGraphBuilder';
import {report} from './ReporterRunner';

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

  async bundle(graph: AssetGraph): Promise<BundleGraph> {
    report({
      type: 'buildProgress',
      phase: 'bundling'
    });

    let bundler = await this.config.getBundler();

    let bundleGraph = new BundleGraph();
    await bundler.bundle(graph, bundleGraph, this.options);
    await this.nameBundles(bundleGraph);
    await this.applyRuntimes(bundleGraph);

    return bundleGraph;
  }

  async nameBundles(bundleGraph: BundleGraph): Promise<void> {
    let namers = await this.config.getNamers();
    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      promises.push(this.nameBundle(namers, bundle));
    });

    await Promise.all(promises);
  }

  async nameBundle(namers: Array<Namer>, bundle: Bundle): Promise<void> {
    for (let namer of namers) {
      let filePath = await namer.name(bundle, {
        rootDir: this.rootDir
      });

      if (filePath != null) {
        bundle.filePath = filePath;
        return;
      }
    }

    throw new Error('Unable to name bundle');
  }

  async applyRuntimes(bundleGraph: BundleGraph): Promise<void> {
    let bundles = [];
    bundleGraph.traverseBundles(bundle => {
      bundles.push(bundle);
    });

    for (let bundle of bundles) {
      await this.applyRuntimesToBundle(bundleGraph, bundle);
    }
  }

  async applyRuntimesToBundle(
    bundleGraph: BundleGraph,
    bundle: Bundle
  ): Promise<void> {
    // HACK. TODO: move this into some sort of asset graph proxy
    // $FlowFixMe
    bundle.assetGraph.addRuntimeAsset = this.addRuntimeAsset.bind(
      this,
      bundleGraph,
      bundle
    );

    let runtimes = await this.config.getRuntimes(bundle.env.context);
    for (let runtime of runtimes) {
      await runtime.apply(bundle, this.options);
    }
  }

  async addRuntimeAsset(
    bundleGraph: BundleGraph,
    bundle: Bundle,
    node: {id: string},
    transformerRequest: TransformerRequest
  ): Promise<Asset> {
    let builder = new AssetGraphBuilder({
      options: this.options,
      config: this.config,
      rootDir: this.rootDir,
      transformerRequest
    });

    let graph: AssetGraph = await builder.build();
    let entry = graph.getEntryAssets()[0];
    let subGraph = graph.getSubGraph(nullthrows(graph.getNode(entry.id)));

    // Exclude modules that are already included in an ancestor bundle
    subGraph.traverseAssets(asset => {
      if (bundleGraph.isAssetInAncestorBundle(bundle, asset)) {
        subGraph.removeAsset(asset);
      }
    });

    bundle.assetGraph.merge(subGraph);
    bundle.assetGraph.addEdge({from: node.id, to: entry.id});
    return entry;
  }
}
