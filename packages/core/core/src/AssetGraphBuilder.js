// @flow
import {EventEmitter} from 'events';
import {AbortController} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import Watcher from '@parcel/watcher';
import PromiseQueue from './PromiseQueue';
import AssetGraph from './AssetGraph';
import ResolverRunner from './ResolverRunner';
import WorkerFarm from '@parcel/workers';

const abortError = new Error('Build aborted');

type Signal = {
  aborted: boolean,
  addEventListener?: Function
};

type BuildOpts = {
  signal: Signal,
  shallow?: boolean
};

export default class AssetGraphBuilder extends EventEmitter {
  graph: AssetGraph;
  watcher: Watcher;
  queue: PromiseQueue;
  resolverRunner: ResolverRunner;
  farm: WorkerFarm;
  runTransform: (file: TransformerRequest) => Promise<any>;

  constructor(opts) {
    super();

    this.farm = opts.farm;
    this.runTransform = this.farm.mkhandle('runTransform');

    this.graph = new AssetGraph();
    this.watcher = opts.watch ? new Watcher() : null;
    this.queue = new PromiseQueue();

    this.resolverRunner = new ResolverRunner({
      config: opts.config,
      cliOpts: opts.cliOpts,
      rootDir: opts.rootDir
    });

    this.graph.initializeGraph(opts);

    this.controller = new AbortController();

    if (this.watcher) {
      this.watcher.on('change', async filePath => {
        if (this.graph.hasNode(filePath)) {
          this.controller.abort();
          this.graph.invalidateFile(filePath);

          this.emit('invalidate', filePath);
        }
      });
    }
  }

  async build() {
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
}
