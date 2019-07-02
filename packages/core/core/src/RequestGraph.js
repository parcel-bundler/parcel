// @flow strict-local
import invariant from 'assert';
//$FlowFixMe
import {isMatch} from 'micromatch';
import nullthrows from 'nullthrows';
import path from 'path';

import {localResolve} from '@parcel/local-require';
import {PromiseQueue, md5FromString, md5FromObject} from '@parcel/utils';
import type {AssetRequest, FilePath, Glob, ParcelOptions} from '@parcel/types';
import type {Event} from '@parcel/watcher';
import WorkerFarm from '@parcel/workers';

import type Config from './public/Config';
import ConfigLoader from './ConfigLoader';
import Dependency from './Dependency';
import Graph, {type GraphOpts} from './Graph';
import type ParcelConfig from './ParcelConfig';
import ResolverRunner from './ResolverRunner';
import type InternalAsset from './Asset';
import type {
  AssetRequestNode,
  ConfigRequest,
  ConfigRequestNode,
  DepPathRequestNode,
  DepVersionRequestNode,
  GlobNode,
  NodeId,
  RequestGraphNode,
  RequestNode,
  SubRequestNode,
  TransformationOpts
} from './types';

type RequestGraphOpts = {|
  ...GraphOpts<RequestGraphNode>,
  config: ParcelConfig,
  options: ParcelOptions,
  onAssetRequestComplete: (AssetRequestNode, Array<InternalAsset>) => mixed,
  onDepPathRequestComplete: (DepPathRequestNode, AssetRequest | null) => mixed
|};

const hashObject = obj => {
  return md5FromString(JSON.stringify(obj));
};

const nodeFromDepPathRequest = (dep: Dependency) => ({
  id: dep.id,
  type: 'dep_path_request',
  value: dep
});

const nodeFromAssetRequest = (assetRequest: AssetRequest) => ({
  id: hashObject(assetRequest),
  type: 'asset_request',
  value: assetRequest
});

const nodeFromConfigRequest = (configRequest: ConfigRequest) => ({
  id: md5FromString(
    `${configRequest.filePath}:${
      configRequest.plugin != null ? configRequest.plugin : 'parcel'
    }`
  ),
  type: 'config_request',
  value: configRequest
});

const nodeFromDepVersionRequest = depVersionRequest => ({
  id: md5FromObject(depVersionRequest),
  type: 'dep_version_request',
  value: depVersionRequest
});

const nodeFromFilePath = (filePath: string) => ({
  id: filePath,
  type: 'file',
  value: {filePath}
});

const nodeFromGlob = (glob: Glob) => ({
  id: glob,
  type: 'glob',
  value: glob
});

export default class RequestGraph extends Graph<RequestGraphNode> {
  // $FlowFixMe
  inProgress: Map<NodeId, Promise<any>> = new Map();
  invalidNodes: Map<NodeId, RequestNode> = new Map();
  runTransform: TransformationOpts => Promise<{
    assets: Array<InternalAsset>,
    configRequests: Array<ConfigRequest>
  }>;
  loadConfigHandle: () => Promise<Config>;
  resolverRunner: ResolverRunner;
  configLoader: ConfigLoader;
  onAssetRequestComplete: (AssetRequestNode, Array<InternalAsset>) => mixed;
  onDepPathRequestComplete: (DepPathRequestNode, AssetRequest | null) => mixed;
  queue: PromiseQueue;
  farm: WorkerFarm;
  config: ParcelConfig;
  options: ParcelOptions;
  globNodes: Array<GlobNode>;
  depVersionRequestNodes: Array<DepVersionRequestNode>;

  constructor({
    onAssetRequestComplete,
    onDepPathRequestComplete,
    config,
    options,
    ...graphOpts
  }: RequestGraphOpts) {
    super(graphOpts);
    this.options = options;
    this.queue = new PromiseQueue();
    this.globNodes = [];
    this.depVersionRequestNodes = [];
    this.onAssetRequestComplete = onAssetRequestComplete;
    this.onDepPathRequestComplete = onDepPathRequestComplete;
    this.config = config;
    this.options = options;

    this.resolverRunner = new ResolverRunner({
      config,
      options
    });

    this.configLoader = new ConfigLoader(options);
  }

  async initFarm() {
    // This expects the worker farm to already be initialized by Parcel prior to calling
    // AssetGraphBuilder, which avoids needing to pass the options through here.
    this.farm = await WorkerFarm.getShared();
    this.runTransform = this.farm.createHandle('runTransform');
    this.loadConfigHandle = WorkerFarm.createReverseHandle(
      this.loadConfig.bind(this)
    );
  }

  async completeRequests() {
    if (!this.farm) {
      await this.initFarm();
    }

    for (let [, node] of this.invalidNodes) {
      this.processNode(node);
    }

    await this.queue.run();
  }

  addNode(node: RequestGraphNode) {
    this.processNode(node);
    if (node.type === 'glob') {
      this.globNodes.push(node);
    } else if (node.type === 'dep_version_request') {
      this.depVersionRequestNodes.push(node);
    }
    return super.addNode(node);
  }

  addDepPathRequest(dep: Dependency) {
    let requestNode = nodeFromDepPathRequest(dep);
    if (!this.hasNode(requestNode.id)) {
      this.addNode(requestNode);
    }
  }

  addAssetRequest(request: AssetRequest) {
    let requestNode = nodeFromAssetRequest(request);
    if (!this.hasNode(requestNode.id)) {
      this.addNode(requestNode);
    }

    this.connectFile(requestNode, request.filePath);
  }

  async processNode(requestNode: RequestGraphNode) {
    let promise;
    switch (requestNode.type) {
      case 'asset_request':
        promise = this.queue.add(() =>
          this.transform(requestNode).then(result => {
            this.onAssetRequestComplete(requestNode, result);
            return result;
          })
        );
        break;
      case 'dep_path_request':
        promise = this.queue.add(() =>
          this.resolvePath(requestNode.value).then(result => {
            this.onDepPathRequestComplete(requestNode, result);
            return result;
          })
        );
        break;
      case 'config_request':
        promise = this.runConfigRequest(requestNode);
        break;
      case 'dep_version_request':
        promise = this.runDepVersionRequest(requestNode);
        break;
      default:
      // Do nothing
    }

    if (promise) {
      try {
        this.inProgress.set(requestNode.id, promise);
        await promise;
        // ? Should these be updated before it comes off the queue?
        this.invalidNodes.delete(requestNode.id);
        this.inProgress.delete(requestNode.id);
      } catch (e) {
        // Do nothing
        // Main tasks will be caught by the queue
        // Sub tasks will end up rejecting the main task promise
      }
    }
  }

  async transform(requestNode: AssetRequestNode) {
    try {
      let start = Date.now();
      let request = requestNode.value;
      let {assets, configRequests} = await this.runTransform({
        request,
        loadConfig: this.loadConfigHandle,
        parentNodeId: requestNode.id,
        options: this.options
      });

      let time = Date.now() - start;
      for (let asset of assets) {
        asset.stats.time = time;
      }

      let configRequestNodes = configRequests.map(configRequest => {
        let id = nodeFromConfigRequest(configRequest).id;
        return nullthrows(this.getNode(id));
      });
      this.replaceNodesConnectedTo(
        requestNode,
        configRequestNodes,
        node => node.type === 'config_request'
      );

      return assets;
    } catch (e) {
      // TODO: add connectedFiles even if it failed so we can try a rebuild if those files change
      throw e;
    }
  }

  async resolvePath(dep: Dependency) {
    try {
      let assetRequest = await this.resolverRunner.resolve(dep);

      this.connectFile(nodeFromDepPathRequest(dep), assetRequest.filePath);
      return assetRequest;
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' && dep.isOptional) {
        return null;
      }

      throw err;
    }
  }

  async loadConfig(configRequest: ConfigRequest, parentNodeId: NodeId) {
    let configRequestNode = nodeFromConfigRequest(configRequest);
    this.ensureConnection(
      nullthrows(this.getNode(parentNodeId)),
      configRequestNode
    );

    let config = nullthrows(await this.getSubTaskResult(configRequestNode));
    invariant(config.devDeps != null);

    let depVersionRequestNodes = [];
    for (let [moduleSpecifier] of config.devDeps) {
      let depVersionRequest = {
        moduleSpecifier,
        resolveFrom: path.dirname(nullthrows(config.resolvedPath)) // TODO: resolveFrom should be nearest package boundary
      };
      let depVersionRequestNode = nodeFromDepVersionRequest(depVersionRequest);
      this.ensureConnection(configRequestNode, depVersionRequestNode);
      depVersionRequestNodes.push(
        nullthrows(this.getNode(depVersionRequestNode.id))
      );

      let version = await this.getSubTaskResult(depVersionRequestNode);
      config.setDevDep(depVersionRequest.moduleSpecifier, version);
    }
    this.replaceNodesConnectedTo(
      configRequestNode,
      depVersionRequestNodes,
      node => node.type === 'dep_version_request'
    );

    return config;
  }

  async runConfigRequest(configRequestNode: ConfigRequestNode) {
    let configRequest = configRequestNode.value;
    let config = await this.configLoader.load(configRequest);
    configRequest.result = config;

    let invalidationNodes = [];

    if (config.resolvedPath != null) {
      invalidationNodes.push(nodeFromFilePath(config.resolvedPath));
    }

    for (let filePath of config.includedFiles) {
      invalidationNodes.push(nodeFromFilePath(filePath));
    }

    if (config.watchGlob != null) {
      invalidationNodes.push(nodeFromGlob(config.watchGlob));
    }

    this.replaceNodesConnectedTo(
      configRequestNode,
      invalidationNodes,
      node => node.type === 'file' || node.type === 'glob'
    );

    return config;
  }

  async runDepVersionRequest(requestNode: DepVersionRequestNode) {
    let {value: request} = requestNode;
    let {moduleSpecifier, resolveFrom} = request;
    let [, resolvedPkg] = await localResolve(
      `${moduleSpecifier}/package.json`,
      `${resolveFrom}/index`
    );

    // TODO: Figure out how to handle when local plugin packages change, since version won't be enough
    let version = nullthrows(resolvedPkg).version;
    request.result = version;

    return version;
  }

  addSubRequest(subRequestNode: SubRequestNode, nodeId: NodeId) {
    if (!this.nodes.has(subRequestNode.id)) {
      this.addNode(subRequestNode);
      this.processNode(subRequestNode);
    }

    if (!this.hasEdge(nodeId, subRequestNode.id)) {
      this.addEdge(nodeId, subRequestNode.id);
    }

    return subRequestNode;
  }

  //$FlowFixMe
  async getSubTaskResult(node: SubRequestNode): any {
    let result;
    if (this.inProgress.has(node.id)) {
      result = await this.inProgress.get(node.id);
    } else {
      result = this.getResultFromGraph(node);
    }

    return result;
  }

  getResultFromGraph(subRequestNode: SubRequestNode) {
    let node = nullthrows(this.getNode(subRequestNode.id));
    invariant(
      node.type === 'config_request' || node.type === 'dep_version_request'
    );
    return node.value.result;
  }

  connectFile(requestNode: RequestNode, filePath: FilePath) {
    let fileNode = nodeFromFilePath(filePath);
    if (!this.hasNode(fileNode.id)) {
      this.addNode(fileNode);
    }

    if (!this.hasEdge(requestNode.id, fileNode.id)) {
      this.addEdge(requestNode.id, fileNode.id);
    }
  }

  connectGlob(requestNode: RequestNode, glob: Glob) {
    let globNode = nodeFromGlob(glob);
    if (!this.hasNode(globNode.id)) {
      this.addNode(globNode);
    }

    if (!this.hasEdge(requestNode.id, globNode.id)) {
      this.addEdge(requestNode.id, globNode.id);
    }
  }

  invalidateNode(node: RequestNode) {
    switch (node.type) {
      case 'asset_request':
      case 'dep_path_request':
        this.invalidNodes.set(node.id, node);
        break;
      case 'config_request':
      case 'dep_version_request': {
        this.invalidNodes.set(node.id, node);
        let mainRequestNode = nullthrows(this.getMainRequestNode(node));
        this.invalidNodes.set(mainRequestNode.id, mainRequestNode);
        break;
      }
      default:
        throw new Error(
          `Cannot invalidate node with unrecognized type ${node.type}`
        );
    }
  }

  getMainRequestNode(node: SubRequestNode) {
    let [parentNode] = this.getNodesConnectedTo(node);
    if (parentNode.type === 'config_request') {
      [parentNode] = this.getNodesConnectedTo(parentNode);
    }
    invariant(parentNode.type !== 'file' && parentNode.type !== 'glob');
    return parentNode;
  }

  // TODO: add edge types to make invalidation more flexible and less precarious
  respondToFSEvents(events: Array<Event>) {
    for (let {path, type} of events) {
      if (path === this.options.lockFile) {
        for (let depVersionRequestNode of this.depVersionRequestNodes) {
          this.invalidateNode(depVersionRequestNode);
        }
      }

      let node = this.getNode(path);

      let connectedNodes =
        node && node.type === 'file' ? this.getNodesConnectedTo(node) : [];

      // TODO: invalidate dep path requests that have failed and this creation may fulfill the request
      if (node && (type === 'create' || type === 'update')) {
        // sometimes mac reports update events as create events
        if (node.type === 'file') {
          for (let connectedNode of connectedNodes) {
            if (
              connectedNode.type === 'asset_request' ||
              connectedNode.type === 'config_request'
            ) {
              this.invalidateNode(connectedNode);
            }
          }
        }
      } else if (type === 'create') {
        for (let globNode of this.globNodes) {
          if (isMatch(path, globNode.value)) {
            let connectedNodes = this.getNodesConnectedTo(globNode);
            for (let connectedNode of connectedNodes) {
              invariant(
                connectedNode.type !== 'file' && connectedNode.type !== 'glob'
              );
              this.invalidateNode(connectedNode);
            }
          }
        }
      } else if (node && type === 'delete') {
        for (let connectedNode of connectedNodes) {
          if (
            connectedNode.type === 'dep_path_request' ||
            connectedNode.type === 'config_request'
          ) {
            this.invalidateNode(connectedNode);
          }
        }
      }
    }
  }

  isInvalid() {
    return this.invalidNodes.size > 0;
  }
}
