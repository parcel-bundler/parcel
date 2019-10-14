// @flow strict-local

import type {Namer} from '@parcel/types';
import type {Bundle as InternalBundle, ParcelOptions} from './types';
import type ParcelConfig from './ParcelConfig';
import type WorkerFarm from '@parcel/workers';
import type AssetGraphBuilder from './AssetGraphBuilder';

import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import AssetGraph from './AssetGraph';
import BundleGraph from './public/BundleGraph';
import InternalBundleGraph, {removeAssetGroups} from './BundleGraph';
import MutableBundleGraph from './public/MutableBundleGraph';
import {Bundle} from './public/Bundle';
import {report} from './ReporterRunner';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';
import {normalizeSeparators, unique, md5FromObject} from '@parcel/utils';
import PluginOptions from './public/PluginOptions';
import applyRuntimes from './applyRuntimes';
import {PARCEL_VERSION} from './constants';

type Opts = {|
  options: ParcelOptions,
  config: ParcelConfig,
  runtimesBuilder: AssetGraphBuilder,
  workerFarm: WorkerFarm
|};

export default class BundlerRunner {
  options: ParcelOptions;
  config: ParcelConfig;
  pluginOptions: PluginOptions;
  farm: WorkerFarm;
  runtimesBuilder: AssetGraphBuilder;
  isBundling: boolean = false;

  constructor(opts: Opts) {
    this.options = opts.options;
    this.config = opts.config;
    this.pluginOptions = new PluginOptions(this.options);
    this.runtimesBuilder = opts.runtimesBuilder;
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

    await applyRuntimes({
      bundleGraph: internalBundleGraph,
      runtimesBuilder: this.runtimesBuilder,
      config: this.config,
      options: this.options,
      pluginOptions: this.pluginOptions
    });
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
      parcelVersion: PARCEL_VERSION,
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
}
