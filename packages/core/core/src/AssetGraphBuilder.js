// @flow

import type {
  ParcelOptions,
  Dependency,
  FilePath,
  Node,
  Target,
  TransformerRequest
} from '@parcel/types';
import type Config from './Config';
import EventEmitter from 'events';
import {
  AbortController,
  type AbortSignal
} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import watcher from '@parcel/watcher';
import PromiseQueue from '@parcel/utils/src/PromiseQueue';
import AssetGraph from './AssetGraph';
import ResolverRunner from './ResolverRunner';
import WorkerFarm from '@parcel/workers';
import path from 'path';

type BuildOpts = {|
  signal: AbortSignal,
  shallow?: boolean
|};

type Opts = {|
  options: ParcelOptions,
  config: Config,
  entries?: Array<string>,
  targets?: Array<Target>,
  transformerRequest?: TransformerRequest,
  rootDir: FilePath
|};

type WatcherSubscription = {|
  unsubscribe(): void
|};

export default class AssetGraphBuilder extends EventEmitter {
  graph: AssetGraph;
  watcher: WatcherSubscription;
  options: ParcelOptions;
  rootDir: FilePath;
  queue: PromiseQueue;
  resolverRunner: ResolverRunner;
  controller: AbortController;
  farm: WorkerFarm;
  runTransform: (file: TransformerRequest) => Promise<any>;

  constructor({
    config,
    options,
    rootDir,
    entries,
    targets,
    transformerRequest
  }: Opts) {
    super();

    this.options = options;
    this.rootDir = rootDir;

    this.queue = new PromiseQueue();
    this.resolverRunner = new ResolverRunner({
      config,
      options,
      rootDir
    });

    this.graph = new AssetGraph();
    this.graph.initializeGraph({entries, targets, transformerRequest, rootDir});

    this.controller = new AbortController();
  }

  async init() {
    // This expects the worker farm to already be initialized by Parcel prior to calling
    // AssetGraphBuilder, which avoids needing to pass the options through here.
    this.farm = await WorkerFarm.getShared();
    this.runTransform = this.farm.mkhandle('runTransform');

    if (this.options.watch) {
      let ignore = ['.git', '.hg', '.parcel-cache'].map(dir =>
        path.join(this.rootDir, dir)
      );
      this.watcher = await watcher.subscribe(
        this.rootDir,
        (err, events) => {
          if (err) {
            // TODO
            this.emit('error', err);
            return;
          }

          this.handleChangeEvents(events);
        },
        {ignore}
      );
    }
  }

  async build() {
    if (!this.farm) {
      await this.init();
    }

    this.controller = new AbortController();
    let signal = this.controller.signal;

    await this.updateGraph({signal});
    await this.completeGraph({signal});
    return this.graph;
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
      throw new BuildAbortError();
    }

    let req = {filePath: resolvedPath, env: dep.env};
    let {newRequest} = this.graph.resolveDependency(dep, req);

    if (newRequest) {
      this.queue.add(() => this.transform(newRequest, {signal}));
    }
  }

  async transform(req: TransformerRequest, {signal, shallow}: BuildOpts) {
    let start = Date.now();
    let cacheEntry = await this.runTransform(req);
    let time = Date.now() - start;

    for (let asset of cacheEntry.assets) {
      asset.stats.time = time;
    }

    if (signal.aborted) throw new BuildAbortError();
    let {
      addedFiles,
      removedFiles,
      newDeps
    } = this.graph.resolveTransformerRequest(req, cacheEntry);

    // The shallow option is used during the update phase
    if (!shallow) {
      for (let dep of newDeps) {
        this.queue.add(() => this.resolve(dep, {signal}));
      }
    }
  }

  handleChangeEvents(events) {
    let invalidated = false;

    for (let event of events) {
      if (this.graph.hasNode(event.path)) {
        invalidated = true;
        this.graph.invalidateFile(event.path);
      }
    }

    if (invalidated) {
      this.controller.abort();
      this.emit('invalidate');
    }
  }

  stop() {
    this.watcher.unsubscribe();
  }
}

export class BuildAbortError extends Error {
  name = 'BuildAbortError';
}
