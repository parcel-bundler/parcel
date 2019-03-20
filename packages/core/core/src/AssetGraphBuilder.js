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
import Watcher from '@parcel/watcher';
import PromiseQueue from './PromiseQueue';
import AssetGraph, {nodeFromDep} from './AssetGraph';
import ResolverRunner from './ResolverRunner';
import WorkerFarm from '@parcel/workers';
import {localResolve} from '@parcel/utils/src/localRequire';
import fs from '@parcel/fs';
import ConfigLoader from './ConfigLoader';

import prettyFormat from 'pretty-format';

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

export default class AssetGraphBuilder extends EventEmitter {
  graph: AssetGraph;
  watcher: Watcher;
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

    this.queue = new PromiseQueue();
    this.resolverRunner = new ResolverRunner({
      config,
      options,
      rootDir
    });

    this.graph = new AssetGraph();
    this.graph.initializeGraph({entries, targets, transformerRequest, rootDir});

    this.controller = new AbortController();
    if (options.watch) {
      this.watcher = new Watcher();
      this.watcher.on('change', async filePath => {
        if (this.graph.hasNode(filePath)) {
          this.controller.abort();
          this.graph.invalidateFile(filePath);

          this.emit('invalidate', filePath);
        }
      });
    }
  }

  async initFarm() {
    // This expects the worker farm to already be initialized by Parcel prior to calling
    // AssetGraphBuilder, which avoids needing to pass the options through here.
    this.farm = await WorkerFarm.getShared();
    this.runTransform = this.farm.mkhandle('runTransform');
  }

  async build() {
    if (!this.farm) {
      await this.initFarm();
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
        return this.resolve(node, {signal});
      case 'transformer_request':
        return this.transform(node, {signal});
      default:
        throw new Error(
          `Cannot process graph node with type ${node.type || 'undefined'}`
        );
    }
  }

  async resolve(node, {signal}: BuildOpts) {
    console.log('RESOLVING', node.value);
    let resolvedPath;
    let dep = node.value;
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
    let {newRequestNode} = this.graph.resolveDependency(dep, req);

    if (newRequestNode) {
      this.queue.add(() => this.transform(newRequestNode, {signal}));
      if (this.watcher) this.watcher.watch(newRequestNode.value.filePath);
    }
  }

  async transform(node, {signal, shallow}: BuildOpts) {
    let start = Date.now();
    await this.loadBuildDependencies(node, {signal, shallow});
    console.log('TRANSFORMING', node.value);
    let req = node.value;

    let cacheEntry = await this.runTransform(req);
    let time = Date.now() - start;

    for (let asset of cacheEntry.assets) {
      asset.stats.time = time;
    }

    if (signal.aborted) throw new BuildAbortError();
    let {
      addedFiles,
      removedFiles,
      newDepNodes
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
      for (let depNode of newDepNodes) {
        this.queue.add(() => this.resolve(depNode, {signal}));
      }
    }
  }

  async loadBuildDependencies(node, buildOpts) {
    let configRequest;
    switch (node.type) {
      case 'transformer_request':
        configRequest = {
          filePath: node.value.filePath,
          configType: 'parcel',
          meta: {
            actionType: 'transformer_request',
            filePath: node.value.filePath
          }
        };
        break;
      case 'dependency':
        configRequest = {
          tool: 'parcel',
          meta: {
            actionType: 'dependency_resolution',
            filePath: node.value.sourcePath
          }
        };
    }

    let configLoader = new ConfigLoader(this.options);

    let {devDeps} = await this.loadConfigAndResolveDependencies(
      configRequest,
      configLoader,
      node
    );

    // await Promise.all(
    //   devDeps.map(async devDep => {
    //     let plugin = this.loadParcelPlugin(devDep.packageName, parcelConfig);
    //     configRequest = plugin.getConfigRequest(node.value);
    //     await this.loadConfigAndResolveDependencies(configRequest, node);
    //   })
    // );
  }

  async loadConfigAndResolveDependencies(
    configRequest,
    configLoader,
    actionNode
  ) {
    let configRequestNode = this.graph.addConfigRequest(
      configRequest,
      actionNode
    );

    let result = await configLoader.load(configRequest);
    let {devDepRequestNodes} = this.graph.resolveConfigRequest(
      result,
      configRequestNode
    );

    await Promise.all(devDepRequestNodes.map(devDepRequestNode => {}));

    return result;
  }

  async resolveDevDep(devDepRequestNode, actionNode) {
    let resolved = await localResolve(`${devDepRequest}/package.json`);
    let {name, version} = JSON.parse(await fs.readFile(resolved));
    this.graph.resolveDevDep(devDepRequestNode, {name, version}, actionNode);
    return {name, version, filePath};
  }

  async loadParcelPlugin(pluginName) {}
}

export class BuildAbortError extends Error {
  name = 'BuildAbortError';
}
