// @flow
'use strict';
import {AbortController} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import Watcher from '@parcel/watcher';
import PromiseQueue from './PromiseQueue';
import AssetGraph from './AssetGraph';
import {Node} from './Graph';
import type {Bundle, CLIOptions, Dependency, File, Target} from '@parcel/types';
import ResolverRunner from './ResolverRunner';
import BundlerRunner from './BundlerRunner';
import Config from './Config';
import WorkerFarm from '@parcel/workers';
import TargetResolver from './TargetResolver';

// TODO: use custom config if present
const defaultConfig = require('@parcel/config-default');

const abortError = new Error('Build aborted');

type ParcelOpts = {
  entries: Array<string>,
  cwd?: string,
  cliOpts: CLIOptions
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
  runTransform: (file: File) => Promise<any>;
  runPackage: (bundle: Bundle) => Promise<any>;

  constructor({entries, cliOpts = {}}: ParcelOpts) {
    this.rootDir = process.cwd();

    this.graph = new AssetGraph({entries, rootDir: this.rootDir});
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
      cliOpts
    });
    this.farm = new WorkerFarm(
      {
        parcelConfig: defaultConfig,
        cliOpts
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    this.targetResolver = new TargetResolver();
    this.targets = [];

    this.runTransform = this.farm.mkhandle('runTransform');
    this.runPackage = this.farm.mkhandle('runPackage');
  }

  async run() {
    let controller = new AbortController();
    let signal = controller.signal;

    this.targets = await this.targetResolver.resolve(this.rootDir);
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

    await buildPromise;
  }

  async build({signal}: BuildOpts) {
    try {
      console.log('Starting build'); // eslint-disable-line no-console
      await this.updateGraph({signal});
      await this.completeGraph({signal});
      await this.graph.dumpGraphViz();
      let bundles = await this.bundle();
      await this.package(bundles);

      if (!this.watcher) {
        await this.farm.end();
      }

      console.log('Finished build'); // eslint-disable-line no-console
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
      case 'file':
        return this.transform(node.value, {signal});
      default:
        throw new Error(
          `Cannot process graph node with type ${node.type || 'undefined'}`
        );
    }
  }

  async resolve(dep: Dependency, {signal}: BuildOpts) {
    let resolvedPath = await this.resolverRunner.resolve(dep);

    if (signal.aborted) throw abortError;

    let file = {filePath: resolvedPath};
    dep.resolvedPath = resolvedPath;
    let {newFile} = this.graph.updateDependency(dep, file);

    if (newFile) {
      this.queue.add(() => this.transform(newFile, {signal}));
      if (this.watcher) this.watcher.watch(newFile.filePath);
    }
  }

  async transform(file: File, {signal, shallow}: BuildOpts) {
    let node = this.graph.getNode(file.filePath);
    if (!node) {
      return;
    }

    let incomingDeps = this.graph.getConnectedNodes(node);
    let environments = incomingDeps.map(dep => dep.value.env);
    console.log(environments);
    let cacheEntry = await this.runTransform(file);

    if (signal.aborted) throw abortError;
    let {addedFiles, removedFiles, newDeps} = this.graph.updateFile(
      file,
      cacheEntry
    );

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

  // TODO: implement bundle types
  package(bundles: any[]) {
    return Promise.all(bundles.map(bundle => this.runPackage(bundle)));
  }
}
