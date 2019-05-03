// @flow

import type {
  FilePath,
  InitialParcelOptions,
  ParcelOptions,
  Stats
} from '@parcel/types';
import type {Bundle} from './types';
import type InternalBundleGraph from './BundleGraph';

import AssetGraph from './AssetGraph';
import {BundleGraph} from './public/BundleGraph';
import BundlerRunner from './BundlerRunner';
import WorkerFarm from '@parcel/workers';
import TargetResolver from './TargetResolver';
import getRootDir from '@parcel/utils/src/getRootDir';
import nullthrows from 'nullthrows';
import loadEnv from './loadEnv';
import clone from 'clone';
import path from 'path';
import Cache from '@parcel/cache';
import AssetGraphBuilder, {BuildAbortError} from './AssetGraphBuilder';
import ConfigResolver from './ConfigResolver';
import ReporterRunner from './ReporterRunner';
import MainAssetGraph from './public/MainAssetGraph';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';

// Default cache directory name
const DEFAULT_CACHE_DIR = '.parcel-cache';

export default class Parcel {
  initialOptions: InitialParcelOptions;
  resolvedOptions: ?ParcelOptions;
  assetGraphBuilder: AssetGraphBuilder;
  bundlerRunner: BundlerRunner;
  reporterRunner: ReporterRunner;
  farm: WorkerFarm;
  runPackage: (bundle: Bundle) => Promise<Stats>;
  _initialized: boolean = false;

  constructor(options: InitialParcelOptions) {
    this.initialOptions = clone(options);
  }

  async init(): Promise<void> {
    if (this._initialized) {
      return;
    }

    let resolvedOptions = (this.resolvedOptions = await resolveOptions(
      this.initialOptions
    ));
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

    this.bundlerRunner = new BundlerRunner({
      options: resolvedOptions,
      config
    });

    this.reporterRunner = new ReporterRunner({
      config,
      options: resolvedOptions
    });

    this.assetGraphBuilder = new AssetGraphBuilder({
      options: resolvedOptions,
      config,
      entries: resolvedOptions.entries,
      targets: resolvedOptions.targets
    });

    this.farm = await WorkerFarm.getShared(
      {
        config,
        options: resolvedOptions,
        env: resolvedOptions.env
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    this.runPackage = this.farm.mkhandle('runPackage');

    this._initialized = true;
  }

  async run(): Promise<InternalBundleGraph> {
    if (!this._initialized) {
      await this.init();
    }

    this.assetGraphBuilder.on('invalidate', () => {
      this.build();
    });

    return this.build();
  }

  async build(): Promise<InternalBundleGraph> {
    try {
      this.reporterRunner.report({
        type: 'buildStart'
      });

      let startTime = Date.now();
      let assetGraph = await this.assetGraphBuilder.build();
      dumpGraphToGraphViz(assetGraph, 'MainAssetGraph');

      let bundleGraph = await this.bundle(assetGraph);
      dumpGraphToGraphViz(bundleGraph, 'BundleGraph');

      await this.package(bundleGraph);

      this.reporterRunner.report({
        type: 'buildSuccess',
        changedAssets: new Map(this.assetGraphBuilder.changedAssets),
        assetGraph: new MainAssetGraph(assetGraph),
        bundleGraph: new BundleGraph(bundleGraph),
        buildTime: Date.now() - startTime
      });

      let resolvedOptions = nullthrows(this.resolvedOptions);
      if (!resolvedOptions.watch && resolvedOptions.killWorkers !== false) {
        await this.farm.end();
      }

      return bundleGraph;
    } catch (e) {
      if (!(e instanceof BuildAbortError)) {
        this.reporterRunner.report({
          type: 'buildFailure',
          error: e
        });
      }
      throw e;
    }
  }

  bundle(assetGraph: AssetGraph): Promise<InternalBundleGraph> {
    return this.bundlerRunner.bundle(assetGraph);
  }

  package(bundleGraph: InternalBundleGraph): Promise<mixed> {
    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      promises.push(
        this.runPackage(bundle).then(stats => {
          bundle.stats = stats;
        })
      );
    });

    return Promise.all(promises);
  }
}

async function resolveOptions(
  initialOptions: InitialParcelOptions
): Promise<ParcelOptions> {
  let entries: Array<FilePath>;
  if (initialOptions.entries == null || initialOptions.entries === '') {
    entries = [];
  } else if (Array.isArray(initialOptions.entries)) {
    entries = initialOptions.entries;
  } else {
    entries = [initialOptions.entries];
  }

  let rootDir =
    initialOptions.rootDir != null
      ? initialOptions.rootDir
      : getRootDir(entries);

  let targets;
  if (initialOptions.targets) {
    targets = initialOptions.targets;
  } else {
    let targetResolver = new TargetResolver();
    targets = await targetResolver.resolve(rootDir);
  }

  if (!initialOptions.env) {
    await loadEnv(path.join(rootDir, 'index'));
  }

  let cacheDir =
    initialOptions.cacheDir != null
      ? initialOptions.cacheDir
      : DEFAULT_CACHE_DIR;

  // $FlowFixMe
  return {
    env: process.env,
    ...initialOptions,
    cacheDir,
    entries,
    rootDir,
    targets
  };
}

export {default as Asset} from './Asset';
export {default as Dependency} from './Dependency';
export {default as Environment} from './Environment';
