// @flow

import type {Node} from './types';

import type {
  ParcelOptions,
  Dependency,
  Target,
  TransformerRequest,
  Asset
} from '@parcel/types';
import type Config from './ParcelConfig';
import EventEmitter from 'events';
import {
  AbortController,
  type AbortSignal
} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import PromiseQueue from '@parcel/utils/src/PromiseQueue';
import AssetGraph, {nodeFromConfigRequest} from './AssetGraph';
import ResolverRunner from './ResolverRunner';
import WorkerFarm from '@parcel/workers';
import Cache from '@parcel/cache';
import {localResolve} from '@parcel/utils/src/localRequire';
import {md5FromString, md5FromFilePath} from '@parcel/utils/src/md5';
import * as fs from '@parcel/fs';
import ConfigLoader from './ConfigLoader';

import prettyFormat from 'pretty-format';
import {isMatch} from 'micromatch';

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
    this.options = options;

    this.queue = new PromiseQueue();
    this.resolverRunner = new ResolverRunner({
      config,
      options
    });
    this.loadConfigHandle = WorkerFarm.createHandle(this.loadConfig.bind(this));

    this.changedAssets = new Map();

    this.graph = new AssetGraph();
    this.graph.initializeGraph({
      entries,
      targets,
      transformerRequest,
      rootDir: options.rootDir
    });

    this.configLoader = new ConfigLoader(this.options);
  }

  async initFarm() {
    // This expects the worker farm to already be initialized by Parcel prior to calling
    // AssetGraphBuilder, which avoids needing to pass the options through here.
    this.farm = await WorkerFarm.getShared();
    this.runTransform = this.farm.mkhandle('runTransform');
  }

  async build({signal}) {
    if (!this.farm) {
      await this.initFarm();
    }

    this.changedAssets = new Map();

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
      case 'config_request':
      case 'dev_dep_request':
        // Do nothing, corresponding transformer requst or dependency node should be processed
        break;
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
    }
  }

  async transform(node, {signal, shallow}: BuildOpts) {
    let start = Date.now();
    let request = node.value;

    let assets = await this.runTransform({
      request,
      node,
      loadConfig: this.loadConfigHandle,
      options: this.options
    });

    let time = Date.now() - start;
    for (let asset of assets) {
      asset.stats.time = time;
      this.changedAssets.set(asset.id, asset);
    }

    if (signal.aborted) throw new BuildAbortError();
    let {newDepNodes} = this.graph.resolveTransformerRequest(request, assets);

    // The shallow option is used during the update phase
    if (!shallow) {
      for (let depNode of newDepNodes) {
        this.queue.add(() => this.resolve(depNode, {signal}));
      }
    }
  }

  async loadConfig(configRequest, actionNode) {
    let configRequestNode = nodeFromConfigRequest(configRequest);
    let config;
    let devDepRequestNodes;

    if (
      !this.graph.hasNode(configRequestNode.id) ||
      this.graph.invalidNodes.has(configRequestNode.id)
    ) {
      console.log('LOADING CONFIG', configRequest);
      this.graph.addConfigRequest(configRequestNode, actionNode);
      config = await this.configLoader.load(configRequest);
      let {devDepRequestNodes: ddrNodes} = this.graph.resolveConfigRequest(
        config,
        configRequestNode
      );
      devDepRequestNodes = ddrNodes;
    } else {
      console.log('CONFIG ALREADY LOADED');
      // TODO: implement these functions
      config = this.graph.getResultingConfig(configRequestNode);
      devDepRequestNodes = this.graph.getConfigDevDepNodes(configRequestNode);
    }

    let devDeps = await Promise.all(
      devDepRequestNodes.map(devDepRequestNode =>
        this.resolveDevDep(devDepRequestNode, actionNode)
      )
    );

    devDeps.forEach(({name, version}) => config.setDevDep(name, version));

    return config;
  }

  async resolveDevDep(devDepRequestNode, actionNode) {
    let [devDepNode] = this.graph.getNodesConnectedFrom(
      devDepRequestNode,
      'resolves_to'
    );

    let devDep;
    // TODO: need better checks, this will still attempt to resolve even if resolving is in progress
    if (!devDepNode || this.graph.invalidNodes.has(devDepRequestNode.id)) {
      console.log('RESOLVING DEV DEP', devDepRequestNode.value);
      let {moduleSpecifier, resolveFrom} = devDepRequestNode.value;
      let [resolvedPath, resolvedPkg] = await localResolve(
        // TODO: localResolve has a cache that should either not be used or cleared appropriately
        `${moduleSpecifier}/package.json`,
        `${resolveFrom}/index`
      );
      let {name, version} = resolvedPkg;
      devDep = {name, version};
      this.graph.resolveDevDepRequest(
        devDepRequestNode,
        {name, version},
        actionNode
      );
    } else {
      devDep = devDepNode.value;
    }

    return devDep;
  }

  isInvalid() {
    return !!this.graph.invalidNodes.size;
  }

  respondToFSChange(event) {
    this.graph.respondToFSChange(event);
  }
}

export class BuildAbortError extends Error {
  name = 'BuildAbortError';
}
