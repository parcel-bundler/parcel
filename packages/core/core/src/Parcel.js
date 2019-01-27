// @flow
'use strict';
import AssetGraph from './AssetGraph';
import type {Bundle, BundleGraph, CLIOptions} from '@parcel/types';
import BundlerRunner from './BundlerRunner';
import Config from './Config';
import WorkerFarm from '@parcel/workers';
import TargetResolver from './TargetResolver';
import getRootDir from '@parcel/utils/getRootDir';
import loadEnv from './loadEnv';
import path from 'path';
import Cache from '@parcel/cache';
import AssetGraphBuilder from './AssetGraphBuilder';
import {Server, HMRServer} from '@parcel/server';
import EventEmitter from 'events';

// TODO: use custom config if present
const defaultConfig = require('@parcel/config-default');

const abortError = new Error('Build aborted');

const DEFAULT_CACHE_DIR = '.parcel-cache';

type ParcelOpts = {
  entries: string | Array<string>,
  cwd?: string,
  cliOpts: CLIOptions,
  killWorkers?: boolean,
  env?: {[string]: ?string}
};

export default class Parcel extends EventEmitter {
  options: ParcelOpts;
  entries: Array<string>;
  rootDir: string;
  assetGraphBuilder: AssetGraphBuilder;
  bundlerRunner: BundlerRunner;
  farm: WorkerFarm;
  server: Server;
  pending: boolean;
  hmrServer: HMRServer;
  error: Error | null;
  runPackage: (bundle: Bundle) => Promise<any>;

  constructor(options: ParcelOpts) {
    super();

    let {entries} = options;
    this.options = options;
    this.normaliseCliOptions();

    this.entries = Array.isArray(entries) ? entries : [entries];
    this.rootDir = getRootDir(this.entries);
  }

  normaliseCliOptions() {
    this.options.cliOpts.cacheDir =
      this.options.cliOpts.cacheDir || DEFAULT_CACHE_DIR;
    if (this.options.cliOpts.cert && this.options.cliOpts.key) {
      this.options.cliOpts.https = {
        cert: this.options.cliOpts.cert,
        key: this.options.cliOpts.key
      };
    }
    this.options.cliOpts.publicURL = this.options.cliOpts.publicURL || '/';
    this.options.cliOpts.hmrPort = this.options.cliOpts.hmrPort || 0;
  }

  async init() {
    await Cache.createCacheDir(this.options.cliOpts.cacheDir);

    if (!this.options.env) {
      await loadEnv(path.join(this.rootDir, 'index'));
      this.options.env = process.env;
    }

    this.farm = await WorkerFarm.getShared(
      {
        parcelConfig: defaultConfig,
        cliOpts: this.options.cliOpts,
        env: this.options.env
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    if (this.options.cliOpts.serve) {
      this.server = await Server.serve(
        this,
        this.options.cliOpts.port,
        this.options.cliOpts.hostname,
        this.options.cliOpts.https
      );
    }

    if (this.options.cliOpts.hot) {
      this.hmrServer = new HMRServer(this.options.cliOpts);
      await this.hmrServer.start();
    }

    this.runPackage = this.farm.mkhandle('runPackage');
  }

  async run() {
    await this.init();

    // TODO: resolve config from filesystem
    let config = new Config(
      defaultConfig,
      require.resolve('@parcel/config-default')
    );

    this.bundlerRunner = new BundlerRunner({
      config,
      cliOpts: this.options.cliOpts,
      rootDir: this.rootDir
    });

    let targetResolver = new TargetResolver();
    let targets = await targetResolver.resolve(this.rootDir);

    this.assetGraphBuilder = new AssetGraphBuilder({
      cliOpts: this.options.cliOpts,
      config,
      entries: this.entries,
      targets,
      rootDir: this.rootDir
    });

    this.assetGraphBuilder.on('invalidate', () => {
      this.build();
    });

    if (this.hmrServer) {
      this.assetGraphBuilder.on('buildEnd', () => {
        this.hmrServer.emitUpdate();
      });
    }

    return await this.build();
  }

  async build() {
    try {
      this.error = null;
      this.pending = true;

      // console.log('Starting build'); // eslint-disable-line no-console
      let assetGraph = await this.assetGraphBuilder.build();
      // await assetGraph.dumpGraphViz();
      let bundleGraph = await this.bundle(assetGraph);
      await this.package(bundleGraph);

      if (!this.options.cliOpts.watch && this.options.killWorkers !== false) {
        await this.farm.end();
      }

      this.pending = false;
      this.emit('bundled');

      // console.log('Finished build'); // eslint-disable-line no-console
      return bundleGraph;
    } catch (e) {
      if (e !== abortError) {
        this.error = e;

        if (this.hmrServer) {
          this.hmrServer.emitError(e);
        }

        console.error(e); // eslint-disable-line no-console
      }
    }
  }

  async stop() {
    await this.assetGraphBuilder.stop();

    if (this.hmrServer) {
      await this.hmrServer.stop();
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
