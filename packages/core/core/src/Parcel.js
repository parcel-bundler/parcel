// @flow

import type {InitialParcelOptions, ParcelOptions, Stats} from '@parcel/types';
import type {Bundle} from './types';
import type InternalBundleGraph from './BundleGraph';

import {Asset} from './public/Asset';
import {BundleGraph} from './public/BundleGraph';
import BundlerRunner from './BundlerRunner';
import WorkerFarm from '@parcel/workers';
import nullthrows from 'nullthrows';
import clone from 'clone';
import Cache from '@parcel/cache';
import AssetGraphBuilder, {BuildAbortError} from './AssetGraphBuilder';
import ConfigResolver from './ConfigResolver';
import ReporterRunner from './ReporterRunner';
import MainAssetGraph from './public/MainAssetGraph';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';
import resolveOptions from './resolveOptions';

export default class Parcel {
  #assetGraphBuilder; // AssetGraphBuilder
  #bundlerRunner; // BundlerRunner
  #farm; // WorkerFarm
  #initialized = false; // boolean
  #initialOptions; // InitialParcelOptions;
  #reporterRunner; // ReporterRunner
  #resolvedOptions; // ?ParcelOptions
  #runPackage; // (bundle: Bundle) => Promise<Stats>;

  constructor(options: InitialParcelOptions) {
    this.#initialOptions = clone(options);
  }

  async init(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    let resolvedOptions: ParcelOptions = await resolveOptions(
      this.#initialOptions
    );
    this.#resolvedOptions = resolvedOptions;
    await Cache.createCacheDir(resolvedOptions.cacheDir);

    let configResolver = new ConfigResolver();
    let config;

    // If an explicit `config` option is passed use that, otherwise resolve a .parcelrc from the filesystem.
    if (resolvedOptions.config) {
      config = await configResolver.create(resolvedOptions.config);
    } else {
      config = await configResolver.resolve(resolvedOptions.rootDir);
    }

    // If no config was found, default to the `defaultConfig` option if one is provided.
    if (!config && resolvedOptions.defaultConfig) {
      config = await configResolver.create(resolvedOptions.defaultConfig);
    }

    if (!config) {
      throw new Error('Could not find a .parcelrc');
    }

    this.#bundlerRunner = new BundlerRunner({
      options: resolvedOptions,
      config
    });

    this.#reporterRunner = new ReporterRunner({
      config,
      options: resolvedOptions
    });

    this.#assetGraphBuilder = new AssetGraphBuilder({
      options: resolvedOptions,
      config,
      entries: resolvedOptions.entries,
      targets: resolvedOptions.targets
    });

    this.#farm = await WorkerFarm.getShared(
      {
        config,
        options: resolvedOptions,
        env: resolvedOptions.env
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    this.#runPackage = this.#farm.mkhandle('runPackage');

    this.#initialized = true;
  }

  // `run()` returns `Promise<?BundleGraph>` because in watch mode it does not
  // return a bundle graph, but outside of watch mode it always will.
  async run(): Promise<?BundleGraph> {
    if (!this.#initialized) {
      await this.init();
    }

    let resolvedOptions = nullthrows(this.#resolvedOptions);
    try {
      this.#assetGraphBuilder.on('invalidate', () => {
        this.build().catch(e => {
          if (!resolvedOptions.watch) {
            throw e;
          }
        });
      });

      let graph = await this.build();
      if (!resolvedOptions.watch) {
        return graph;
      }
    } catch (e) {
      if (!resolvedOptions.watch) {
        throw e;
      }
    }
  }

  async build(): Promise<BundleGraph> {
    try {
      this.#reporterRunner.report({
        type: 'buildStart'
      });

      let startTime = Date.now();
      let {assetGraph, changedAssets} = await this.#assetGraphBuilder.build();
      dumpGraphToGraphViz(assetGraph, 'MainAssetGraph');

      let bundleGraph = await this.#bundlerRunner.bundle(assetGraph);
      dumpGraphToGraphViz(bundleGraph, 'BundleGraph');

      await packageBundles(bundleGraph, this.#runPackage);

      this.#reporterRunner.report({
        type: 'buildSuccess',
        changedAssets: new Map(
          Array.from(changedAssets).map(([id, asset]) => [id, new Asset(asset)])
        ),
        assetGraph: new MainAssetGraph(assetGraph),
        bundleGraph: new BundleGraph(bundleGraph),
        buildTime: Date.now() - startTime
      });

      let resolvedOptions = nullthrows(this.#resolvedOptions);
      if (!resolvedOptions.watch && resolvedOptions.killWorkers !== false) {
        await this.#farm.end();
      }

      return new BundleGraph(bundleGraph);
    } catch (e) {
      if (!(e instanceof BuildAbortError)) {
        await this.#reporterRunner.report({
          type: 'buildFailure',
          error: e
        });
      }

      throw e;
    }
  }
}

function packageBundles(
  bundleGraph: InternalBundleGraph,
  runPackage: (bundle: Bundle) => Promise<Stats>
): Promise<mixed> {
  let promises = [];
  bundleGraph.traverseBundles(bundle => {
    promises.push(
      runPackage(bundle).then(stats => {
        bundle.stats = stats;
      })
    );
  });

  return Promise.all(promises);
}

export {default as Asset} from './Asset';
export {default as Dependency} from './Dependency';
export {default as Environment} from './Environment';
