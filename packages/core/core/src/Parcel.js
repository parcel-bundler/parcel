// @flow

import type {InitialParcelOptions, ParcelOptions, Stats} from '@parcel/types';
import type {Bundle} from './types';
import type InternalBundleGraph from './BundleGraph';

import AssetGraph, {BuildAbortError} from './NewAssetGraph';
import {BundleGraph} from './public/BundleGraph';
import BundlerRunner from './BundlerRunner';
import WorkerFarm from '@parcel/workers';
import nullthrows from 'nullthrows';
import clone from 'clone';
import loadParcelConfig from './loadParcelConfig';
import path from 'path';
import Cache from '@parcel/cache';
import Watcher from '@parcel/watcher';
import ReporterRunner from './ReporterRunner';
import MainAssetGraph from './public/MainAssetGraph';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';
import resolveOptions from './resolveOptions';

// TODO: tmp, remove
import prettyFormat from 'pretty-format';

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
    this.resolvedOptions = resolvedOptions;
    await Cache.createCacheDir(resolvedOptions.cacheDir);

    // ? What to use for filePath
    let config = await loadParcelConfig(resolvedOptions.cwd, resolvedOptions);

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

    this.bundlerRunner = new BundlerRunner({
      options: resolvedOptions,
      config
    });

    this.reporterRunner = new ReporterRunner({
      config,
      options: resolvedOptions
    });

    this.assetGraph = new AssetGraph({
      options: resolvedOptions,
      config,
      entries: resolvedOptions.entries,
      targets: resolvedOptions.targets
    });

    this.runPackage = this.farm.mkhandle('runPackage');

    this._initialized = true;
  }

  async run(): Promise<BundleGraph> {
    if (!this._initialized) {
      await this.init();
    }

    if (this.initialOptions.watch) {
      this.watcher = new Watcher();
      this.watcher.watch(this.resolvedOptions.projectRoot);
      this.watcher.on('all', (event, path) => {
        if (path.includes('.parcel-cache')) return; // TODO: unwatch from watcher, couldn't get it working
        // TODO: filter out dist changes
        console.log('DETECTED CHANGE', event, path);
        this.assetGraph.respondToFSChange({
          action: event,
          path
        });
        if (this.assetGraph.isInvalid()) {
          console.log('ASSET GRAPH IS INVALID');
          this.build();
        }
      });
    }

    return this.build();
  }

  async build(): Promise<BundleGraph> {
    try {
      this.reporterRunner.report({
        type: 'buildStart'
      });

      let startTime = Date.now();
      // console.log('Starting build'); // eslint-disable-line no-console

      await this.assetGraph.build();
      console.log('DONE BUILDING ASSET GRAPH');
      await dumpGraphToGraphViz(this.assetGraph, 'MainAssetGraph');

      let bundleGraph = await this.bundle(this.assetGraph);
      console.log('DONE BUNDLING');
      dumpGraphToGraphViz(bundleGraph, 'BundleGraph');

      await this.package(bundleGraph);

      this.reporterRunner.report({
        type: 'buildSuccess',
        changedAssets: new Map(this.assetGraph.changedAssets),
        assetGraph: new MainAssetGraph(this.assetGraph),
        bundleGraph: new BundleGraph(bundleGraph),
        buildTime: Date.now() - startTime
      });

      let resolvedOptions = nullthrows(this.resolvedOptions);
      if (!resolvedOptions.watch && resolvedOptions.killWorkers !== false) {
        await this.farm.end();
      }

      return new BundleGraph(bundleGraph);
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
export {default as Asset} from './Asset';
export {default as Dependency} from './Dependency';
export {default as Environment} from './Environment';
