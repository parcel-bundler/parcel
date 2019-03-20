// @flow

import type {Bundle, BundleGraph, ParcelOptions, Stats} from '@parcel/types';

import AssetGraph from './AssetGraph';
import BundlerRunner from './BundlerRunner';
import WorkerFarm from '@parcel/workers';
import TargetResolver from './TargetResolver';
import getRootDir from '@parcel/utils/src/getRootDir';
import loadEnv from './loadEnv';
import path from 'path';
import Cache from '@parcel/cache';
import AssetGraphBuilder, {BuildAbortError} from './AssetGraphBuilder';
import ReporterRunner from './ReporterRunner';

export default class Parcel {
  options: ParcelOptions;
  entries: Array<string>;
  rootDir: string;
  assetGraphBuilder: AssetGraphBuilder;
  bundlerRunner: BundlerRunner;
  reporterRunner: ReporterRunner;
  farm: WorkerFarm;
  runPackage: (bundle: Bundle) => Promise<Stats>;

  constructor(options: ParcelOptions) {
    this.options = options;
    this.options.projectRoot = process.cwd();
    this.entries = Array.isArray(options.entries)
      ? options.entries
      : options.entries
        ? [options.entries]
        : [];
    this.rootDir = getRootDir(this.entries);
  }

  async init(): Promise<void> {
    await Cache.createCacheDir(this.options.cacheDir);

    if (!this.options.env) {
      await loadEnv(path.join(this.rootDir, 'index'));
      this.options.env = process.env;
    }

    this.bundlerRunner = new BundlerRunner({
      options: this.options
      rootDir: this.rootDir
    });

    this.reporterRunner = new ReporterRunner({
      config,
      options: this.options
    });

    let targetResolver = new TargetResolver();
    let targets = await targetResolver.resolve(this.rootDir);

    this.assetGraphBuilder = new AssetGraphBuilder({
      options: this.options,
      entries: this.entries,
      targets,
      rootDir: this.rootDir
    });

    this.farm = await WorkerFarm.getShared(
      {
        options: this.options,
        env: this.options.env
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    this.runPackage = this.farm.mkhandle('runPackage');
  }

  async run(): Promise<BundleGraph> {
    await this.init();

    this.assetGraphBuilder.on('invalidate', () => {
      this.build();
    });

    return this.build();
  }

  async build(): Promise<BundleGraph> {
    try {
      this.reporterRunner.report({
        type: 'buildStart'
      });

      let startTime = Date.now();
      let assetGraph = await this.assetGraphBuilder.build();

      //if (process.env.PARCEL_DUMP_GRAPH != null) {
      const dumpGraphToGraphViz = require('@parcel/utils/src/dumpGraphToGraphViz')
        .default;
      await dumpGraphToGraphViz(assetGraph, 'MainAssetGraph');
      //}

      console.log('DONE BUILDING ASSET GRAPH');

      // let bundleGraph = await this.bundle(assetGraph);
      // await this.package(bundleGraph);
      // this.reporterRunner.report({
      //   type: 'buildSuccess',
      //   assetGraph,
      //   bundleGraph,
      //   buildTime: Date.now() - startTime
      // });

      // if (!this.options.watch && this.options.killWorkers !== false) {
      //   await this.farm.end();
      // }

      // return bundleGraph;
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

  bundle(assetGraph: AssetGraph): Promise<BundleGraph> {
    return this.bundlerRunner.bundle(assetGraph);
  }

  package(bundleGraph: BundleGraph): Promise<mixed> {
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
