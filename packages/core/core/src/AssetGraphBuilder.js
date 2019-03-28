// @flow

import type {
  ParcelOptions,
  Dependency,
  FilePath,
  Node,
  Target,
  TransformerRequest
} from '@parcel/types';
import type Config from './ParcelConfig';
import EventEmitter from 'events';
import {type AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import PromiseQueue from './PromiseQueue';
import AssetGraph, {nodeFromDep, nodeFromConfigRequest} from './AssetGraph';
import ResolverRunner from './ResolverRunner';
import WorkerFarm from '@parcel/workers';
import Cache from '@parcel/cache';
import {resolve as localResolve} from '@parcel/utils/src/localRequire';
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
  transformerRequest?: TransformerRequest,
  rootDir: FilePath
|};

export default class AssetGraphBuilder extends EventEmitter {
  graph: AssetGraph;
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
    await this.loadBuildDependencies(node, {signal, shallow});
    console.log('TRANSFORMING', node.value);
    let req = node.value;
    let {configs, devDeps} = await this.loadBuildDependencies(node, {
      signal,
      shallow
    });
    let fileHashes = await Promise.all(
      this.graph
        .getNodesConnectedFrom(node, 'invalidated_by_change_to')
        .map(fileNode => md5FromFilePath(fileNode.value.filePath))
    );

    let cacheKey = md5FromString(
      `${JSON.stringify({configs, devDeps, fileHashes})}`
    );
    // console.log('CACHE READ CONTENT', req.filePath, {
    //   configs,
    //   devDeps,
    //   fileHashes
    // });
    // console.log('PARCEL CONFIG STRINGIFIED', JSON.stringify(configs.parcel));
    // console.log('CACHE READ KEY', cacheKey);

    let cacheEntry = await Cache.get(cacheKey);

    if (!cacheEntry) {
      console.log('TRANSFORMING', req);

      cacheEntry = await this.runTransform({
        req,
        configs,
        devDeps
      });

      let time = Date.now() - start;
      for (let asset of cacheEntry.assets) {
        asset.stats.time = time;
      }
    }

    if (signal.aborted) throw new BuildAbortError();
    let {newDepNodes} = this.graph.resolveTransformerRequest(req, cacheEntry);

    // The shallow option is used during the update phase
    if (!shallow) {
      for (let depNode of newDepNodes) {
        this.queue.add(() => this.resolve(depNode, {signal}));
      }
    }
  }

  async loadBuildDependencies(node, buildOpts) {
    let configRequest = {
      filePath: node.value.filePath,
      configType: 'parcel',
      meta: {
        actionType: node.type
      }
    };

    let configLoader = new ConfigLoader(this.options);

    let {config, devDeps} = await this.loadConfigAndResolveDependencies(
      configRequest,
      configLoader,
      node
    );

    let configs = {parcel: config};

    return {configs, devDeps};

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
    let configRequestNode = nodeFromConfigRequest(configRequest);
    let result;
    let devDepRequestNodes;
    if (
      !this.graph.hasNode(configRequestNode) ||
      this.graph.invalidNodes.has(configRequestNode.id)
    ) {
      this.graph.addConfigRequest(configRequestNode, actionNode);
      console.log('LOADING CONFIG', configRequest);
      result = await configLoader.load(configRequest);
      let {devDepRequestNodes: ddrNodes} = this.graph.resolveConfigRequest(
        result,
        configRequestNode
      );
      devDepRequestNodes = ddrNodes;
    } else {
      devDepRequestNodes = this.graph.getConfigDevDepNodes(configRequestNode);
    }

    let devDeps = await Promise.all(
      devDepRequestNodes.map(devDepRequestNode =>
        this.resolveDevDep(devDepRequestNode, actionNode)
      )
    );

    return {config: result.config, devDeps};
  }

  async resolveDevDep(devDepRequestNode, actionNode) {
    let [devDepNode] = this.graph.getNodesConnectedFrom(
      devDepRequestNode,
      'resolves_to'
    );

    let devDep;
    if (!devDepNode || this.graph.invalidNodes.has(devDepRequestNode.id)) {
      console.log('RESOLVING DEV DEP', devDepRequestNode.value);
      let {moduleSpecifier, sourcePath} = devDepRequestNode.value;
      let [resolvedPath, resolvedPkg] = await localResolve(
        // TODO: localResolve has a cache that should either not be used or cleared appropriately
        `${moduleSpecifier}/package.json`,
        sourcePath
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
