// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {Async, File, FilePath, Glob, EnvMap} from '@parcel/types';
import type {Event, Options as WatcherOptions} from '@parcel/watcher';
import type WorkerFarm from '@parcel/workers';
import type {NodeId, ParcelOptions, RequestInvalidation} from './types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import {isGlobMatch, md5FromObject, md5FromString} from '@parcel/utils';
import {PARCEL_VERSION} from './constants';
import Graph, {type GraphOpts} from './Graph';
import {assertSignalNotAborted, hashFromOption} from './utils';

type SerializedRequestGraph = {|
  ...GraphOpts<RequestGraphNode, RequestGraphEdgeType>,
  invalidNodeIds: Set<NodeId>,
  incompleteNodeIds: Set<NodeId>,
  globNodeIds: Set<NodeId>,
  envNodeIds: Set<NodeId>,
  optionNodeIds: Set<NodeId>,
  unpredicatableNodeIds: Set<NodeId>,
|};

type FileNode = {|id: string, +type: 'file', value: File|};
type GlobNode = {|id: string, +type: 'glob', value: Glob|};
type EnvNode = {|
  id: string,
  +type: 'env',
  value: {|key: string, value: string | void|},
|};

type OptionNode = {|
  id: string,
  +type: 'option',
  value: {|key: string, hash: string|},
|};

type Request<TInput, TResult> = {|
  id: string,
  +type: string,
  input: TInput,
  run: ({|input: TInput, ...StaticRunOpts<TResult>|}) => Async<TResult>,
|};

type StoredRequest = {|
  id: string,
  +type: string,
  input: mixed,
  result?: mixed,
  resultCacheKey?: ?string,
|};

type RequestNode = {|
  id: string,
  +type: 'request',
  value: StoredRequest,
|};
type RequestGraphNode =
  | RequestNode
  | FileNode
  | GlobNode
  | EnvNode
  | OptionNode;

type RequestGraphEdgeType =
  | 'subrequest'
  | 'invalidated_by_update'
  | 'invalidated_by_delete'
  | 'invalidated_by_create';

export type RunAPI = {|
  invalidateOnFileCreate: Glob => void,
  invalidateOnFileDelete: FilePath => void,
  invalidateOnFileUpdate: FilePath => void,
  invalidateOnStartup: () => void,
  invalidateOnEnvChange: string => void,
  invalidateOnOptionChange: string => void,
  getInvalidations(): Array<RequestInvalidation>,
  storeResult: (result: mixed, cacheKey?: string) => void,
  canSkipSubrequest(string): boolean,
  runRequest: <TInput, TResult>(
    subRequest: Request<TInput, TResult>,
    opts?: RunRequestOpts,
  ) => Async<TResult>,
|};

type RunRequestOpts = {|
  force: boolean,
|};

export type StaticRunOpts<TResult> = {|
  farm: WorkerFarm,
  options: ParcelOptions,
  api: RunAPI,
  prevResult: ?TResult,
|};

const nodeFromFilePath = (filePath: string) => ({
  id: filePath,
  type: 'file',
  value: {filePath},
});

const nodeFromGlob = (glob: Glob) => ({
  id: glob,
  type: 'glob',
  value: glob,
});

const nodeFromRequest = (request: StoredRequest) => ({
  id: request.id,
  type: 'request',
  value: request,
});

const nodeFromEnv = (env: string, value: string | void) => ({
  id: 'env:' + env,
  type: 'env',
  value: {
    key: env,
    value,
  },
});

const nodeFromOption = (option: string, value: mixed) => ({
  id: 'option:' + option,
  type: 'option',
  value: {
    key: option,
    hash: hashFromOption(value),
  },
});

export class RequestGraph extends Graph<
  RequestGraphNode,
  RequestGraphEdgeType,
> {
  invalidNodeIds: Set<NodeId> = new Set();
  incompleteNodeIds: Set<NodeId> = new Set();
  globNodeIds: Set<NodeId> = new Set();
  envNodeIds: Set<NodeId> = new Set();
  optionNodeIds: Set<NodeId> = new Set();
  // Unpredictable nodes are requests that cannot be predicted whether they should rerun based on
  // filesystem changes alone. They should rerun on each startup of Parcel.
  unpredicatableNodeIds: Set<NodeId> = new Set();

  // $FlowFixMe
  static deserialize(opts: SerializedRequestGraph): RequestGraph {
    // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
    let deserialized = new RequestGraph(opts);
    deserialized.invalidNodeIds = opts.invalidNodeIds;
    deserialized.incompleteNodeIds = opts.incompleteNodeIds;
    deserialized.globNodeIds = opts.globNodeIds;
    deserialized.envNodeIds = opts.envNodeIds;
    deserialized.optionNodeIds = opts.optionNodeIds;
    deserialized.unpredicatableNodeIds = opts.unpredicatableNodeIds;
    // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381 (Windows only)
    return deserialized;
  }

  // $FlowFixMe
  serialize(): SerializedRequestGraph {
    return {
      ...super.serialize(),
      invalidNodeIds: this.invalidNodeIds,
      incompleteNodeIds: this.incompleteNodeIds,
      globNodeIds: this.globNodeIds,
      envNodeIds: this.envNodeIds,
      optionNodeIds: this.optionNodeIds,
      unpredicatableNodeIds: this.unpredicatableNodeIds,
    };
  }

  addNode(node: RequestGraphNode): RequestGraphNode {
    if (!this.hasNode(node.id)) {
      if (node.type === 'glob') {
        this.globNodeIds.add(node.id);
      }

      if (node.type === 'env') {
        this.envNodeIds.add(node.id);
      }

      if (node.type === 'option') {
        this.optionNodeIds.add(node.id);
      }
    }

    return super.addNode(node);
  }

  removeNode(node: RequestGraphNode): void {
    this.invalidNodeIds.delete(node.id);
    this.incompleteNodeIds.delete(node.id);
    if (node.type === 'glob') {
      this.globNodeIds.delete(node.id);
    }
    if (node.type === 'env') {
      this.envNodeIds.delete(node.id);
    }
    if (node.type === 'option') {
      this.optionNodeIds.delete(node.id);
    }
    return super.removeNode(node);
  }

  getRequestNode(
    id: string,
  ): {|id: string, +type: 'request', value: StoredRequest|} {
    let node = nullthrows(this.getNode(id));
    invariant(node.type === 'request');
    return node;
  }

  completeRequest(request: StoredRequest) {
    this.invalidNodeIds.delete(request.id);
    this.incompleteNodeIds.delete(request.id);
  }

  replaceSubrequests(
    requestId: string,
    subrequestNodes: Array<RequestGraphNode>,
  ) {
    let requestNode = this.getRequestNode(requestId);
    if (!this.hasNode(requestId)) {
      this.addNode(requestNode);
    }

    this.replaceNodesConnectedTo(
      requestNode,
      subrequestNodes,
      null,
      'subrequest',
    );
  }

  invalidateNode(node: RequestGraphNode) {
    invariant(node.type === 'request');
    if (this.hasNode(node.id)) {
      this.invalidNodeIds.add(node.id);

      let parentNodes = this.getNodesConnectedTo(node, 'subrequest');
      for (let parentNode of parentNodes) {
        this.invalidateNode(parentNode);
      }
    }
  }

  invalidateUnpredictableNodes() {
    for (let nodeId of this.unpredicatableNodeIds) {
      let node = nullthrows(this.getNode(nodeId));
      invariant(node.type !== 'file' && node.type !== 'glob');
      this.invalidateNode(node);
    }
  }

  invalidateEnvNodes(env: EnvMap) {
    for (let nodeId of this.envNodeIds) {
      let node = nullthrows(this.getNode(nodeId));
      invariant(node.type === 'env');
      if (env[node.value.key] !== node.value.value) {
        let parentNodes = this.getNodesConnectedTo(
          node,
          'invalidated_by_update',
        );
        for (let parentNode of parentNodes) {
          this.invalidateNode(parentNode);
        }
      }
    }
  }

  invalidateOptionNodes(options: ParcelOptions) {
    for (let nodeId of this.optionNodeIds) {
      let node = nullthrows(this.getNode(nodeId));
      invariant(node.type === 'option');
      if (hashFromOption(options[node.value.key]) !== node.value.hash) {
        let parentNodes = this.getNodesConnectedTo(
          node,
          'invalidated_by_update',
        );
        for (let parentNode of parentNodes) {
          this.invalidateNode(parentNode);
        }
      }
    }
  }

  invalidateOnFileUpdate(requestId: string, filePath: FilePath) {
    let requestNode = this.getRequestNode(requestId);
    let fileNode = nodeFromFilePath(filePath);
    if (!this.hasNode(fileNode.id)) {
      this.addNode(fileNode);
    }

    if (!this.hasEdge(requestNode.id, fileNode.id, 'invalidated_by_update')) {
      this.addEdge(requestNode.id, fileNode.id, 'invalidated_by_update');
    }
  }

  invalidateOnFileDelete(requestId: string, filePath: FilePath) {
    let requestNode = this.getRequestNode(requestId);
    let fileNode = nodeFromFilePath(filePath);
    if (!this.hasNode(fileNode.id)) {
      this.addNode(fileNode);
    }

    if (!this.hasEdge(requestNode.id, fileNode.id, 'invalidated_by_delete')) {
      this.addEdge(requestNode.id, fileNode.id, 'invalidated_by_delete');
    }
  }

  invalidateOnFileCreate(requestId: string, glob: Glob) {
    let requestNode = this.getRequestNode(requestId);
    let globNode = nodeFromGlob(glob);
    if (!this.hasNode(globNode.id)) {
      this.addNode(globNode);
    }

    if (!this.hasEdge(requestNode.id, globNode.id, 'invalidated_by_create')) {
      this.addEdge(requestNode.id, globNode.id, 'invalidated_by_create');
    }
  }

  invalidateOnStartup(requestId: string) {
    let requestNode = this.getRequestNode(requestId);
    this.unpredicatableNodeIds.add(requestNode.id);
  }

  invalidateOnEnvChange(requestId: string, env: string, value: string | void) {
    let requestNode = this.getRequestNode(requestId);
    let envNode = nodeFromEnv(env, value);
    if (!this.hasNode(envNode.id)) {
      this.addNode(envNode);
    }

    if (!this.hasEdge(requestNode.id, envNode.id, 'invalidated_by_update')) {
      this.addEdge(requestNode.id, envNode.id, 'invalidated_by_update');
    }
  }

  invalidateOnOptionChange(requestId: string, option: string, value: mixed) {
    let requestNode = this.getRequestNode(requestId);
    let optionNode = nodeFromOption(option, value);
    if (!this.hasNode(optionNode.id)) {
      this.addNode(optionNode);
    }

    if (!this.hasEdge(requestNode.id, optionNode.id, 'invalidated_by_update')) {
      this.addEdge(requestNode.id, optionNode.id, 'invalidated_by_update');
    }
  }

  clearInvalidations(node: RequestNode) {
    this.unpredicatableNodeIds.delete(node.id);
    this.replaceNodesConnectedTo(node, [], null, 'invalidated_by_update');
    this.replaceNodesConnectedTo(node, [], null, 'invalidated_by_delete');
    this.replaceNodesConnectedTo(node, [], null, 'invalidated_by_create');
  }

  getInvalidations(requestId: string): Array<RequestInvalidation> {
    if (!this.hasNode(requestId)) {
      return [];
    }

    // For now just handling updates. Could add creates/deletes later if needed.
    let requestNode = this.getRequestNode(requestId);
    let invalidations = this.getNodesConnectedFrom(
      requestNode,
      'invalidated_by_update',
    );
    return invalidations
      .map(node => {
        switch (node.type) {
          case 'file':
            return {type: 'file', filePath: node.value.filePath};
          case 'env':
            return {type: 'env', key: node.value.key};
        }
      })
      .filter(Boolean);
  }

  respondToFSEvents(events: Array<Event>): boolean {
    for (let {path, type} of events) {
      let node = this.getNode(path);

      // sometimes mac os reports update events as create events
      // if it was a create event, but the file already exists in the graph,
      // then we can assume it was actually an update event
      if (node && (type === 'create' || type === 'update')) {
        for (let connectedNode of this.getNodesConnectedTo(
          node,
          'invalidated_by_update',
        )) {
          this.invalidateNode(connectedNode);
        }
      } else if (type === 'create') {
        for (let id of this.globNodeIds) {
          let globNode = this.getNode(id);
          invariant(globNode && globNode.type === 'glob');

          if (isGlobMatch(path, globNode.value)) {
            let connectedNodes = this.getNodesConnectedTo(
              globNode,
              'invalidated_by_create',
            );
            for (let connectedNode of connectedNodes) {
              this.invalidateNode(connectedNode);
            }
          }
        }
      } else if (node && type === 'delete') {
        for (let connectedNode of this.getNodesConnectedTo(
          node,
          'invalidated_by_delete',
        )) {
          this.invalidateNode(connectedNode);
        }
      }
    }

    return this.invalidNodeIds.size > 0;
  }
}

export default class RequestTracker {
  graph: RequestGraph;
  farm: WorkerFarm;
  options: ParcelOptions;
  signal: ?AbortSignal;

  constructor({
    graph,
    farm,
    options,
  }: {|
    graph?: RequestGraph,
    farm: WorkerFarm,
    options: ParcelOptions,
  |}) {
    this.graph = graph || new RequestGraph();
    this.farm = farm;
    this.options = options;
  }

  // TODO: refactor (abortcontroller should be created by RequestTracker)
  setSignal(signal?: AbortSignal) {
    this.signal = signal;
  }

  startRequest(request: StoredRequest) {
    if (!this.graph.hasNode(request.id)) {
      let node = nodeFromRequest(request);
      this.graph.addNode(node);
    } else {
      // Clear existing invalidations for the request so that the new
      // invalidations created during the request replace the existing ones.
      this.graph.clearInvalidations(this.graph.getRequestNode(request.id));
    }

    this.graph.incompleteNodeIds.add(request.id);
    this.graph.invalidNodeIds.delete(request.id);
  }

  removeRequest(id: string) {
    this.graph.removeById(id);
  }

  // If a cache key is provided, the result will be removed from the node and stored in a separate cache entry
  storeResult(id: string, result: mixed, cacheKey: ?string) {
    let node = this.graph.getNode(id);
    if (node && node.type === 'request') {
      node.value.result = result;
      node.value.resultCacheKey = cacheKey;
    }
  }

  hasValidResult(id: string): boolean {
    return (
      this.graph.nodes.has(id) &&
      !this.graph.invalidNodeIds.has(id) &&
      !this.graph.incompleteNodeIds.has(id)
    );
  }

  async getRequestResult<T>(id: string): Async<?T> {
    let node = nullthrows(this.graph.getNode(id));
    invariant(node.type === 'request');
    if (node.value.result != undefined) {
      // $FlowFixMe
      let result: T = (node.value.result: any);
      return result;
    } else if (node.value.resultCacheKey != null) {
      let cachedResult: T = (nullthrows(
        await this.options.cache.get(node.value.resultCacheKey),
        // $FlowFixMe
      ): any);
      node.value.result = cachedResult;
      return cachedResult;
    }
  }

  completeRequest(id: string) {
    this.graph.invalidNodeIds.delete(id);
    this.graph.incompleteNodeIds.delete(id);
  }

  rejectRequest(id: string) {
    this.graph.incompleteNodeIds.delete(id);
    if (this.graph.hasNode(id)) {
      this.graph.invalidNodeIds.add(id);
    }
  }

  respondToFSEvents(events: Array<Event>): boolean {
    return this.graph.respondToFSEvents(events);
  }

  hasInvalidRequests(): boolean {
    return this.graph.invalidNodeIds.size > 0;
  }

  getInvalidRequests(): Array<StoredRequest> {
    let invalidRequests = [];
    for (let id of this.graph.invalidNodeIds) {
      let node = nullthrows(this.graph.getNode(id));
      invariant(node.type === 'request');
      invalidRequests.push(node.value);
    }
    return invalidRequests;
  }

  replaceSubrequests(
    requestId: string,
    subrequestNodes: Array<RequestGraphNode>,
  ) {
    this.graph.replaceSubrequests(requestId, subrequestNodes);
  }

  async runRequest<TInput, TResult>(
    request: Request<TInput, TResult>,
    opts?: ?RunRequestOpts,
  ): Async<TResult> {
    let id = request.id;

    let hasValidResult = this.hasValidResult(id);
    if (!opts?.force && hasValidResult) {
      // $FlowFixMe
      return this.getRequestResult<TResult>(id);
    }

    let {api, subRequests} = this.createAPI(id);
    try {
      this.startRequest({id, type: request.type, input: request.input});
      let result = await request.run({
        input: request.input,
        api,
        farm: this.farm,
        options: this.options,
        prevResult: await this.getRequestResult<TResult>(id),
      });

      assertSignalNotAborted(this.signal);
      this.completeRequest(id);

      return result;
    } catch (err) {
      this.rejectRequest(id);
      throw err;
    } finally {
      this.graph.replaceSubrequests(
        id,
        [...subRequests].map(subRequestId =>
          nullthrows(this.graph.getNode(subRequestId)),
        ),
      );
    }
  }

  createAPI(requestId: string): {|api: RunAPI, subRequests: Set<NodeId>|} {
    let subRequests = new Set();
    let api = {
      invalidateOnFileCreate: glob =>
        this.graph.invalidateOnFileCreate(requestId, glob),
      invalidateOnFileDelete: filePath =>
        this.graph.invalidateOnFileDelete(requestId, filePath),
      invalidateOnFileUpdate: filePath =>
        this.graph.invalidateOnFileUpdate(requestId, filePath),
      invalidateOnStartup: () => this.graph.invalidateOnStartup(requestId),
      invalidateOnEnvChange: env =>
        this.graph.invalidateOnEnvChange(requestId, env, this.options.env[env]),
      invalidateOnOptionChange: option =>
        this.graph.invalidateOnOptionChange(
          requestId,
          option,
          this.options[option],
        ),
      getInvalidations: () => this.graph.getInvalidations(requestId),
      storeResult: (result, cacheKey) => {
        this.storeResult(requestId, result, cacheKey);
      },
      canSkipSubrequest: id => {
        if (this.hasValidResult(id)) {
          subRequests.add(id);
          return true;
        }

        return false;
      },
      runRequest: <TInput, TResult>(
        subRequest: Request<TInput, TResult>,
        opts?: RunRequestOpts,
      ): Async<TResult> => {
        subRequests.add(subRequest.id);
        return this.runRequest<TInput, TResult>(subRequest, opts);
      },
    };

    return {api, subRequests};
  }

  async writeToCache() {
    let cacheKey = md5FromObject({
      parcelVersion: PARCEL_VERSION,
      entries: this.options.entries,
    });

    let requestGraphKey = md5FromString(`${cacheKey}:requestGraph`);
    let snapshotKey = md5FromString(`${cacheKey}:snapshot`);

    if (this.options.shouldDisableCache) {
      return;
    }

    let promises = [];
    for (let [, node] of this.graph.nodes) {
      if (node.type !== 'request') {
        continue;
      }

      let resultCacheKey = node.value.resultCacheKey;
      if (resultCacheKey != null && node.value.result != null) {
        promises.push(
          this.options.cache.set(resultCacheKey, node.value.result),
        );
        delete node.value.result;
      }
    }

    promises.push(this.options.cache.set(requestGraphKey, this.graph));

    let opts = getWatcherOptions(this.options);
    let snapshotPath = this.options.cache._getCachePath(snapshotKey, '.txt');
    promises.push(
      this.options.inputFS.writeSnapshot(
        this.options.projectRoot,
        snapshotPath,
        opts,
      ),
    );

    await Promise.all(promises);
  }

  static async init({
    farm,
    options,
  }: {|
    farm: WorkerFarm,
    options: ParcelOptions,
  |}): Async<RequestTracker> {
    let graph = await loadRequestGraph(options);
    return new RequestTracker({farm, options, graph});
  }
}

export function getWatcherOptions(options: ParcelOptions): WatcherOptions {
  let vcsDirs = ['.git', '.hg'].map(dir => path.join(options.projectRoot, dir));
  let ignore = [options.cacheDir, ...vcsDirs];
  return {ignore};
}

async function loadRequestGraph(options): Async<RequestGraph> {
  if (options.shouldDisableCache) {
    return new RequestGraph();
  }

  let cacheKey = md5FromObject({
    parcelVersion: PARCEL_VERSION,
    entries: options.entries,
  });

  let requestGraphKey = md5FromString(`${cacheKey}:requestGraph`);
  let requestGraph = await options.cache.get<RequestGraph>(requestGraphKey);

  if (requestGraph) {
    let opts = getWatcherOptions(options);
    let snapshotKey = md5FromString(`${cacheKey}:snapshot`);
    let snapshotPath = options.cache._getCachePath(snapshotKey, '.txt');
    let events = await options.inputFS.getEventsSince(
      options.projectRoot,
      snapshotPath,
      opts,
    );
    requestGraph.invalidateUnpredictableNodes();
    requestGraph.invalidateEnvNodes(options.env);
    requestGraph.invalidateOptionNodes(options);
    requestGraph.respondToFSEvents(events);

    return requestGraph;
  }

  return new RequestGraph();
}
