// @flow
'use strict';
import {AbortController} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import Watcher from '@parcel/watcher';
import PromiseQueue from './PromiseQueue';
import AssetGraph from './AssetGraph';
import {Node} from './Graph';
import type {
  Bundle,
  BundleGraph,
  CLIOptions,
  Dependency,
  Target,
  TransformerRequest
} from '@parcel/types';
import ResolverRunner from './ResolverRunner';
import BundlerRunner from './BundlerRunner';
import Config from './Config';
import WorkerFarm from '@parcel/workers';
import TargetResolver from './TargetResolver';
import getRootDir from '@parcel/utils/getRootDir';
import loadEnv from './loadEnv';
import path from 'path';
import Cache from '@parcel/cache';

// TODO: use custom config if present
const defaultConfig = require('@parcel/config-default');

const abortError = new Error('Build aborted');

type ParcelOpts = {
  entries: string | Array<string>,
  cwd?: string,
  cliOpts: CLIOptions,
  killWorkers?: boolean,
  env?: {[string]: ?string}
};

type Signal = {
  aborted: boolean,
  addEventListener?: Function
};

type BuildOpts = {
  signal: Signal,
  shallow?: boolean
};

export default class Parcel {
  options: ParcelOpts;
  entries: Array<string>;
  rootDir: string;
  graph: AssetGraph;
  watcher: Watcher;
  queue: PromiseQueue;
  resolverRunner: ResolverRunner;
  bundlerRunner: BundlerRunner;
  farm: WorkerFarm;
  targetResolver: TargetResolver;
  targets: Array<Target>;
  runTransform: (file: TransformerRequest) => Promise<any>;
  runPackage: (bundle: Bundle) => Promise<any>;

  constructor(options: ParcelOpts) {
    let {entries, cliOpts} = options;
    this.options = options;
    this.entries = Array.isArray(entries) ? entries : [entries];
    this.rootDir = getRootDir(this.entries);

    this.graph = new AssetGraph();
    this.watcher = cliOpts.watch ? new Watcher() : null;
    this.queue = new PromiseQueue();

    let config = new Config(
      defaultConfig,
      require.resolve('@parcel/config-default')
    );
    this.resolverRunner = new ResolverRunner({
      config,
      cliOpts,
      rootDir: this.rootDir
    });
    this.bundlerRunner = new BundlerRunner({
      config,
      cliOpts,
      rootDir: this.rootDir
    });

    this.targetResolver = new TargetResolver();
    this.targets = [];
  }

  async run() {
    let controller = new AbortController();
    let signal = controller.signal;

    Cache.createCacheDir(this.options.cliOpts.cacheDir);

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

    this.runTransform = this.farm.mkhandle('runTransform');
    this.runPackage = this.farm.mkhandle('runPackage');

    this.targets = await this.targetResolver.resolve(this.rootDir);
    this.graph.initializeGraph({
      entries: this.entries,
      targets: this.targets,
      rootDir: this.rootDir
    });

    let buildPromise = this.build({signal});

    if (this.watcher) {
      this.watcher.on('change', filePath => {
        if (this.graph.hasNode(filePath)) {
          controller.abort();
          this.graph.invalidateFile(filePath);

          controller = new AbortController();
          signal = controller.signal;

          this.build({signal});
        }
      });
    }

    return await buildPromise;
  }

  async build({signal}: BuildOpts) {
    try {
      // console.log('Starting build'); // eslint-disable-line no-console
      await this.updateGraph({signal});
      await this.completeGraph({signal});
      // await this.graph.dumpGraphViz();
      let bundleGraph = await this.bundle();
      await this.package(bundleGraph);

      if (!this.watcher && this.options.killWorkers !== false) {
        await this.farm.end();
      }

      // console.log('Finished build'); // eslint-disable-line no-console
      return bundleGraph;
    } catch (e) {
      if (e !== abortError) {
        console.error(e); // eslint-disable-line no-console
      }
    }
  }

  async updateGraph({signal}: BuildOpts) {
    for (let [, node] of this.graph.invalidNodes) {
      this.queue.add(() => this.processNode(node, {signal, shallow: true}));
    }
    await this.queue.run();
  }

  async completeGraph({signal}: BuildOpts) {
    for (let [, node] of this.graph.incompleteNodes) {
      this.queue.add(() => this.processNode(node, {signal}));
    }

    await this.queue.run();
  }

  processNode(node: Node, {signal}: BuildOpts) {
    switch (node.type) {
      case 'dependency':
        return this.resolve(node.value, {signal});
      case 'transformer_request':
        return this.transform(node.value, {signal});
      default:
        throw new Error(
          `Cannot process graph node with type ${node.type || 'undefined'}`
        );
    }
  }

  async resolve(dep: Dependency, {signal}: BuildOpts) {
    let resolvedPath;
    try {
      resolvedPath = await this.resolverRunner.resolve(dep);
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' && dep.isOptional) {
        return;
      }

      throw err;
    }

    if (signal.aborted) {
      throw abortError;
    }

    let req = {filePath: resolvedPath, env: dep.env};
    let {newRequest} = this.graph.resolveDependency(dep, req);

    if (newRequest) {
      this.queue.add(() => this.transform(newRequest, {signal}));
      if (this.watcher) this.watcher.watch(newRequest.filePath);
    }
  }

  async transform(req: TransformerRequest, {signal, shallow}: BuildOpts) {
    let cacheEntry = await this.runTransform(req);

    if (signal.aborted) throw abortError;
    let {
      addedFiles,
      removedFiles,
      newDeps
    } = this.graph.resolveTransformerRequest(req, cacheEntry);

    if (this.watcher) {
      for (let file of addedFiles) {
        this.watcher.watch(file.filePath);
      }

      for (let file of removedFiles) {
        this.watcher.unwatch(file.filePath);
      }
    }

    // The shallow option is used during the update phase
    if (!shallow) {
      for (let dep of newDeps) {
        this.queue.add(() => this.resolve(dep, {signal}));
      }
    }
  }

  bundle() {
    return this.bundlerRunner.bundle(this.graph);
  }

  package(bundleGraph: BundleGraph) {
    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      promises.push(this.runPackage(bundle));
    });

    return Promise.all(promises);
  }
}
