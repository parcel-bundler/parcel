// @flow

import type {Node} from './types';
import type {
  ParcelOptions,
  Dependency,
  Target,
  TransformerRequest
} from '@parcel/types';
import type Asset from './Asset';
import type Config from './Config';

import EventEmitter from 'events';
import {
  AbortController,
  type AbortSignal
} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import {PromiseQueue} from '@parcel/utils';
import AssetGraph from './AssetGraph';
import ResolverRunner from './ResolverRunner';
import WorkerFarm from '@parcel/workers';
import type {Event} from '@parcel/watcher';

type BuildOpts = {|
  signal: AbortSignal,
  shallow?: boolean
|};

type Opts = {|
  options: ParcelOptions,
  config: Config,
  entries?: Array<string>,
  targets?: Array<Target>,
  transformerRequest?: TransformerRequest
|};

export default class AssetGraphBuilder extends EventEmitter {
  graph: AssetGraph;
  queue: PromiseQueue;
  resolverRunner: ResolverRunner;
  controller: AbortController;
  farm: WorkerFarm;
  runTransform: (file: TransformerRequest) => Promise<any>;
  changedAssets: Map<string, Asset>;

  constructor({config, options, entries, targets, transformerRequest}: Opts) {
    super();

    this.queue = new PromiseQueue();
    this.resolverRunner = new ResolverRunner({
      config,
      options
    });

    this.changedAssets = new Map();

    this.graph = new AssetGraph();
    this.graph.initializeGraph({
      entries,
      targets,
      transformerRequest,
      rootDir: options.rootDir
    });
  }

  async initFarm() {
    // This expects the worker farm to already be initialized by Parcel prior to calling
    // AssetGraphBuilder, which avoids needing to pass the options through here.
    this.farm = await WorkerFarm.getShared();
    this.runTransform = this.farm.mkhandle('runTransform');
  }

  async build(): Promise<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>
  |}> {
    if (!this.farm) {
      await this.initFarm();
    }

    if (this.controller) this.controller.abort();
    this.controller = new AbortController();
    let signal = this.controller.signal;

    this.changedAssets = new Map();

    await this.updateGraph({signal});
    await this.completeGraph({signal});
    return {assetGraph: this.graph, changedAssets: this.changedAssets};
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
    let req;
    try {
      req = await this.resolverRunner.resolve(dep);
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' && dep.isOptional) {
        return;
      }

      throw err;
    }

    if (signal.aborted) {
      throw new BuildAbortError();
    }

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
      this.changedAssets.set(asset.id, asset);
    }

    if (signal.aborted) throw new BuildAbortError();
    let {newDeps} = this.graph.resolveTransformerRequest(req, cacheEntry);

    // The shallow option is used during the update phase
    if (!shallow) {
      for (let dep of newDeps) {
        this.queue.add(() => this.resolve(dep, {signal}));
      }
    }
  }

  isInvalid() {
    return this.graph.invalidNodes.size > 0;
  }

  respondToFSEvents(events: Array<Event>) {
    for (let {type, path} of events) {
      // TODO: eventually handle all types of events
      if (
        // macOS often sends a 'create' event when a file is actually updated
        (type === 'update' || type === 'create') &&
        this.graph.hasNode(path)
      ) {
        this.graph.invalidateFile(path);
      }
    }
  }
}

export class BuildAbortError extends Error {
  name = 'BuildAbortError';
}
