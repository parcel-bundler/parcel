// @flow
'use strict';
import AssetGraph from './AssetGraph';
import type {
  Bundle,
  BundleGraph,
  ParcelOptions,
  TransformerRequest
} from '@parcel/types';
import BundlerRunner from './BundlerRunner';
import WorkerFarm from '@parcel/workers';
import TargetResolver from './TargetResolver';
import getRootDir from '@parcel/utils/getRootDir';
import loadEnv from './loadEnv';
import path from 'path';
import Cache from '@parcel/cache';
import AssetGraphBuilder from './AssetGraphBuilder';
import ConfigResolver from './ConfigResolver';
import ReporterRunner from './ReporterRunner';

const abortError = new Error('Build aborted');

export default class Parcel {
  options: ParcelOptions;
  entries: Array<string>;
  rootDir: string;
  assetGraphBuilder: AssetGraphBuilder;
  bundlerRunner: BundlerRunner;
  reporterRunner: ReporterRunner;
  farm: WorkerFarm;
  runPackage: (bundle: Bundle) => Promise<any>;

  constructor(options: ParcelOptions) {
    this.options = options;
    this.entries = Array.isArray(options.entries)
      ? options.entries
      : [options.entries];
    this.rootDir = getRootDir(this.entries);
  }

  async init() {
    await Cache.createCacheDir(this.options.cacheDir);

    if (!this.options.env) {
      // await loadEnv(path.join(this.rootDir, 'index'));
      this.options.env = process.env;
    }

    let configResolver = new ConfigResolver();
    let config;

    // If an explicit `config` option is passed use that, otherwise resolve a .parcelrc from the filesystem.
    if (this.options.config) {
      config = await configResolver.create(
        this.options.config,
        this.options.configPath || this.rootDir
      );
    } else {
      config = await configResolver.resolve(this.rootDir);
    }

    // If no config was found, default to the `defaultConfig` option if one is provided.
    if (!config && this.options.defaultConfig) {
      config = await configResolver.create(
        this.options.defaultConfig,
        this.options.defaultConfigPath || this.rootDir
      );
    }

    if (!config) {
      throw new Error('Could not find a .parcelrc');
    }

    this.bundlerRunner = new BundlerRunner({
      config,
      options: this.options,
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
      config,
      entries: this.entries,
      targets,
      rootDir: this.rootDir
    });

    this.farm = await WorkerFarm.getShared(
      {
        config,
        options: this.options,
        env: this.options.env
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    this.runPackage = this.farm.mkhandle('runPackage');
  }

  async run() {
    await this.init();

    this.assetGraphBuilder.on('invalidate', () => {
      this.build();
    });

    this.assetGraphBuilder.on('transform', (req: TransformerRequest) => {
      this.reporterRunner.report({
        type: 'buildProgress',
        message: `Building ${path.basename(req.filePath)}`
      });
    });

    return await this.build();
  }

  async build() {
    try {
      this.reporterRunner.report({
        type: 'buildStart'
      });

      let startTime = Date.now();
      let assetGraph = await this.assetGraphBuilder.build();

      this.reporterRunner.report({
        type: 'buildProgress',
        message: 'Bundling...'
      });

      // await graph.dumpGraphViz();
      let bundleGraph = await this.bundle(assetGraph);

      this.reporterRunner.report({
        type: 'buildProgress',
        message: 'Packaging...'
      });

      await this.package(bundleGraph);

      this.reporterRunner.report({
        type: 'buildSuccess',
        assetGraph,
        bundleGraph,
        buildTime: Date.now() - startTime
      });

      if (!this.options.watch && this.options.killWorkers !== false) {
        await this.farm.end();
      }

      return bundleGraph;
    } catch (e) {
      if (e !== abortError) {
        // console.error(e); // eslint-disable-line no-console
        this.reporterRunner.report({
          type: 'buildFailure',
          error: e
        });
      }
    }
  }

  bundle(assetGraph: AssetGraph) {
    return this.bundlerRunner.bundle(assetGraph);
  }

  package(bundleGraph: BundleGraph) {
    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      promises.push(this.runPackage(bundle));
    });

    return Promise.all(promises);
  }
}

export {default as Asset} from './Asset';
export {default as Dependency} from './Dependency';
export {default as Environment} from './Environment';
