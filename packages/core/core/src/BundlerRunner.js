// @flow strict-local

import type {Bundle as IBundle, Namer, FilePath} from '@parcel/types';
import type {Bundle as InternalBundle, ParcelOptions} from './types';
import type ParcelConfig from './ParcelConfig';
import type WorkerFarm from '@parcel/workers';
import type AssetGraphBuilder from './AssetGraphBuilder';
import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';

import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import AssetGraph from './AssetGraph';
import BundleGraph from './public/BundleGraph';
import InternalBundleGraph, {removeAssetGroups} from './BundleGraph';
import MutableBundleGraph from './public/MutableBundleGraph';
import {Bundle, NamedBundle} from './public/Bundle';
import {report} from './ReporterRunner';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';
import {normalizeSeparators, unique, md5FromObject} from '@parcel/utils';
import PluginOptions from './public/PluginOptions';
import applyRuntimes from './applyRuntimes';
import {PARCEL_VERSION} from './constants';
import {assertSignalNotAborted} from './utils';

type Opts = {|
  options: ParcelOptions,
  config: ParcelConfig,
  runtimesBuilder: AssetGraphBuilder,
  workerFarm: WorkerFarm,
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

  async bundle(
    graph: AssetGraph,
    {signal}: {|signal: ?AbortSignal|},
  ): Promise<InternalBundleGraph> {
    report({
      type: 'buildProgress',
      phase: 'bundling',
    });

    let cacheKey;
    if (!this.options.disableCache) {
      cacheKey = await this.getCacheKey(graph);
      let cachedBundleGraph = await this.options.cache.get(cacheKey);
      assertSignalNotAborted(signal);

      if (cachedBundleGraph) {
        return cachedBundleGraph;
      }
    }

    let bundleGraph = removeAssetGroups(graph);
    // $FlowFixMe
    let internalBundleGraph = new InternalBundleGraph({graph: bundleGraph});
    await dumpGraphToGraphViz(bundleGraph, 'before_bundle');
    let mutableBundleGraph = new MutableBundleGraph(
      internalBundleGraph,
      this.options,
    );

    let {plugin: bundler} = await this.config.getBundler();

    try {
      await bundler.bundle({
        bundleGraph: mutableBundleGraph,
        options: this.pluginOptions,
        logger: new PluginLogger({origin: this.config.getBundlerName()}),
      });
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, this.config.getBundlerName()),
      });
    }
    assertSignalNotAborted(signal);

    await dumpGraphToGraphViz(bundleGraph, 'after_bundle');
    try {
      await bundler.optimize({
        bundleGraph: mutableBundleGraph,
        options: this.pluginOptions,
        logger: new PluginLogger({origin: this.config.getBundlerName()}),
      });
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, this.config.getBundlerName()),
      });
    }
    assertSignalNotAborted(signal);

    await dumpGraphToGraphViz(bundleGraph, 'after_optimize');
    await this.nameBundles(internalBundleGraph);

    await applyRuntimes({
      bundleGraph: internalBundleGraph,
      runtimesBuilder: this.runtimesBuilder,
      config: this.config,
      options: this.options,
      pluginOptions: this.pluginOptions,
    });
    assertSignalNotAborted(signal);
    await dumpGraphToGraphViz(bundleGraph, 'after_runtimes');

    if (cacheKey != null) {
      await this.options.cache.set(cacheKey, internalBundleGraph);
    }
    assertSignalNotAborted(signal);

    return internalBundleGraph;
  }

  async getCacheKey(assetGraph: AssetGraph) {
    let name = this.config.getBundlerName();
    let {version} = await this.config.getBundler();

    return md5FromObject({
      parcelVersion: PARCEL_VERSION,
      name,
      version,
      hash: assetGraph.getHash(),
    });
  }

  async nameBundles(bundleGraph: InternalBundleGraph): Promise<void> {
    let namers = await this.config.getNamers();
    let bundles = bundleGraph.getBundles();

    await Promise.all(
      bundles.map(bundle => this.nameBundle(namers, bundle, bundleGraph)),
    );

    let bundlePaths = bundles.map(b => b.filePath);
    assert.deepEqual(
      bundlePaths,
      unique(bundlePaths),
      'Bundles must have unique filePaths',
    );
  }

  async nameBundle(
    namers: Array<{|
      name: string,
      version: string,
      plugin: Namer,
      resolveFrom: FilePath,
    |}>,
    internalBundle: InternalBundle,
    internalBundleGraph: InternalBundleGraph,
  ): Promise<void> {
    let bundle = new Bundle(internalBundle, internalBundleGraph, this.options);
    let bundleGraph = new BundleGraph<IBundle>(
      internalBundleGraph,
      (bundle, bundleGraph, options) =>
        new NamedBundle(bundle, bundleGraph, options),
      this.options,
    );

    for (let namer of namers) {
      try {
        let name = await namer.plugin.name({
          bundle,
          bundleGraph,
          options: this.pluginOptions,
          logger: new PluginLogger({origin: namer.name}),
        });

        if (name != null) {
          if (path.extname(name).slice(1) !== bundle.type) {
            throw new Error(
              `Destination name ${name} extension does not match bundle type "${bundle.type}"`,
            );
          }

          let target = nullthrows(internalBundle.target);
          internalBundle.filePath = path.join(
            target.distDir,
            normalizeSeparators(name),
          );
          internalBundle.name = name;
          let {hashReference} = internalBundle;
          internalBundle.displayName = name.includes(hashReference)
            ? name.replace(hashReference, '[hash]')
            : name;

          return;
        }
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, namer.name),
        });
      }
    }

    throw new Error('Unable to name bundle');
  }
}
