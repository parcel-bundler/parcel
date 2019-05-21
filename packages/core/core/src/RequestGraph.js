// @flow strict-local
import {PromiseQueue, md5FromString} from '@parcel/utils';
import type {
  AssetRequest,
  Config,
  FilePath,
  ParcelOptions
} from '@parcel/types';
import type {Event} from '@parcel/watcher';
import WorkerFarm from '@parcel/workers';

import Dependency from './Dependency';
import Graph, {type GraphOpts} from './Graph';
import ResolverRunner from './ResolverRunner';
import type {
  AssetRequestNode,
  CacheEntry,
  DepPathRequestNode,
  NodeId,
  RequestGraphNode,
  RequestNode,
  RequestResult
} from './types';

type RequestGraphOpts = {|
  ...GraphOpts<RequestGraphNode>,
  config: Config,
  options: ParcelOptions,
  onAssetRequestComplete: (AssetRequestNode, CacheEntry) => mixed,
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

const nodeFromFilePath = (filePath: string) => ({
  id: filePath,
  type: 'file',
  value: {filePath}
});

export default class RequestGraph extends Graph<RequestGraphNode> {
  inProgress: Map<NodeId, Promise<RequestResult>> = new Map();
  invalidNodes: Map<NodeId, RequestNode> = new Map();
  runTransform: (file: AssetRequest) => Promise<CacheEntry>;
  resolverRunner: ResolverRunner;
  onAssetRequestComplete: (AssetRequestNode, CacheEntry) => mixed;
  onDepPathRequestComplete: (DepPathRequestNode, AssetRequest | null) => mixed;
  queue: PromiseQueue;
  farm: WorkerFarm;

  constructor({
    onAssetRequestComplete,
    onDepPathRequestComplete,
    config,
    options,
    ...graphOpts
  }: RequestGraphOpts) {
    super(graphOpts);
    this.queue = new PromiseQueue();
    this.onAssetRequestComplete = onAssetRequestComplete;
    this.onDepPathRequestComplete = onDepPathRequestComplete;

    this.resolverRunner = new ResolverRunner({
      config,
      options
    });
  }

  async initFarm() {
    // This expects the worker farm to already be initialized by Parcel prior to calling
    // AssetGraphBuilder, which avoids needing to pass the options through here.
    this.farm = await WorkerFarm.getShared();
    this.runTransform = this.farm.mkhandle('runTransform');
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

  addDepPathRequest(dep: Dependency) {
    let requestNode = nodeFromDepPathRequest(dep);
    if (!this.hasNode(requestNode.id)) {
      this.addNode(requestNode);
      this.processNode(requestNode);
    }
  }

  addAssetRequest(request: AssetRequest) {
    let requestNode = nodeFromAssetRequest(request);
    if (!this.hasNode(requestNode.id)) {
      this.addNode(requestNode);
      this.processNode(requestNode);
    }

    this.connectFile(requestNode, request.filePath);
  }

  async processNode(requestNode: RequestNode) {
    let promise;
    switch (requestNode.type) {
      case 'asset_request':
        promise = this.queue.add(() =>
          this.transform(requestNode.value).then(result => {
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
      default:
        throw new Error('Unrecognized request type ' + requestNode.type);
    }

    this.inProgress.set(requestNode.id, promise);
    await promise;
    // ? Should these be updated before it comes off the queue?
    this.invalidNodes.delete(requestNode.id);
    this.inProgress.delete(requestNode.id);
  }

  async transform(request: AssetRequest) {
    try {
      let start = Date.now();
      let cacheEntry = await this.runTransform(request);

      let time = Date.now() - start;
      for (let asset of cacheEntry.assets) {
        asset.stats.time = time;
      }

      return cacheEntry;
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

  connectFile(requestNode: RequestNode, filePath: FilePath) {
    let fileNode = nodeFromFilePath(filePath);
    if (!this.hasNode(fileNode.id)) {
      this.addNode(fileNode);
    }

    if (!this.hasEdge(requestNode.id, fileNode.id)) {
      this.addEdge(requestNode.id, fileNode.id);
    }
  }

  invalidateNode(node: RequestNode) {
    this.invalidNodes.set(node.id, node);
  }

  respondToFSEvents(events: Array<Event>) {
    for (let {path, type} of events) {
      let node = this.getNode(path);
      let connectedNodes = node ? this.getNodesConnectedTo(node) : [];

      if (type === 'create' && !this.hasNode(path)) {
        // TODO: invalidate dep path requests that have failed and this creation may fulfill the request
        // TODO: invalidate glob modules
      } else if (type === 'create' || type === 'update') {
        // sometimes mac reports update events as create events
        for (let connectedNode of connectedNodes) {
          if (connectedNode.type === 'asset_request') {
            this.invalidateNode(connectedNode);
          }
        }
      } else if (type === 'delete') {
        for (let connectedNode of connectedNodes) {
          if (connectedNode.type === 'dep_path_request') {
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
