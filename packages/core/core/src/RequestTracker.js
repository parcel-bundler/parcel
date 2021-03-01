// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {
  Async,
  File,
  FilePath,
  FileCreateInvalidation,
  Glob,
  EnvMap,
} from '@parcel/types';
import type {Event, Options as WatcherOptions} from '@parcel/watcher';
import type WorkerFarm from '@parcel/workers';
import type {NodeId, ParcelOptions, RequestInvalidation} from './types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import {
  isGlobMatch,
  isDirectoryInside,
  md5FromObject,
  md5FromString,
} from '@parcel/utils';
import Graph, {type GraphOpts} from './Graph';
import {assertSignalNotAborted, hashFromOption} from './utils';
import {
  PARCEL_VERSION,
  VALID,
  INITIAL_BUILD,
  FILE_CREATE,
  FILE_UPDATE,
  FILE_DELETE,
  ENV_CHANGE,
  OPTION_CHANGE,
  STARTUP,
  ERROR,
} from './constants';

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
type FileNameNode = {|
  id: string,
  +type: 'file_name',
  value: string,
|};
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

type InvalidateReason = number;
type RequestNode = {|
  id: string,
  +type: 'request',
  value: StoredRequest,
  invalidateReason: InvalidateReason,
|};
type RequestGraphNode =
  | RequestNode
  | FileNode
  | GlobNode
  | FileNameNode
  | EnvNode
  | OptionNode;

type RequestGraphEdgeType =
  | 'subrequest'
  | 'invalidated_by_update'
  | 'invalidated_by_delete'
  | 'invalidated_by_create'
  | 'invalidated_by_create_above'
  | 'dirname';

export type RunAPI = {|
  invalidateOnFileCreate: FileCreateInvalidation => void,
  invalidateOnFileDelete: FilePath => void,
  invalidateOnFileUpdate: FilePath => void,
  invalidateOnStartup: () => void,
  invalidateOnEnvChange: string => void,
  invalidateOnOptionChange: string => void,
  getInvalidations(): Array<RequestInvalidation>,
  storeResult: (result: mixed, cacheKey?: string) => void,
  getRequestResult<T>(id: string): Async<?T>,
  getSubRequests(): Array<StoredRequest>,
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
  invalidateReason: InvalidateReason,
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

const nodeFromFileName = (fileName: string) => ({
  id: 'file_name:' + fileName,
  type: 'file_name',
  value: fileName,
});

const nodeFromRequest = (request: StoredRequest) => ({
  id: request.id,
  type: 'request',
  value: request,
  invalidateReason: INITIAL_BUILD,
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

  getRequestNode(id: string): RequestNode {
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

  invalidateNode(node: RequestGraphNode, reason: InvalidateReason) {
    invariant(node.type === 'request');
    if (this.hasNode(node.id)) {
      node.invalidateReason |= reason;
      this.invalidNodeIds.add(node.id);

      let parentNodes = this.getNodesConnectedTo(node, 'subrequest');
      for (let parentNode of parentNodes) {
        this.invalidateNode(parentNode, reason);
      }
    }
  }

  invalidateUnpredictableNodes() {
    for (let nodeId of this.unpredicatableNodeIds) {
      let node = nullthrows(this.getNode(nodeId));
      invariant(node.type !== 'file' && node.type !== 'glob');
      this.invalidateNode(node, STARTUP);
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
          this.invalidateNode(parentNode, ENV_CHANGE);
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
          this.invalidateNode(parentNode, OPTION_CHANGE);
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

  invalidateOnFileCreate(requestId: string, input: FileCreateInvalidation) {
    let requestNode = this.getRequestNode(requestId);
    let node;
    if (input.glob != null) {
      node = nodeFromGlob(input.glob);
    } else if (input.fileName != null && input.aboveFilePath != null) {
      let aboveFilePath = input.aboveFilePath;

      // Create nodes and edges for each part of the filename pattern.
      // For example, 'node_modules/foo' would create two nodes and one edge.
      // This creates a sort of trie structure within the graph that can be
      // quickly matched by following the edges. This is also memory efficient
      // since common sub-paths (e.g. 'node_modules') are deduplicated.
      let parts = input.fileName.split('/').reverse();
      let last;
      for (let part of parts) {
        let fileNameNode = nodeFromFileName(part);
        if (!this.hasNode(fileNameNode.id)) {
          this.addNode(fileNameNode);
        }

        if (
          last != null &&
          !this.hasEdge(last.id, fileNameNode.id, 'dirname')
        ) {
          this.addEdge(last.id, fileNameNode.id, 'dirname');
        }

        last = fileNameNode;
      }

      // The `aboveFilePath` condition asserts that requests are only invalidated
      // if the file being created is "above" it in the filesystem (e.g. the file
      // is created in a parent directory). There is likely to already be a node
      // for this file in the graph (e.g. the source file) that we can reuse for this.
      node = nodeFromFilePath(aboveFilePath);
      if (!this.hasNode(node.id)) {
        this.addNode(node);
      }

      // Now create an edge from the `aboveFilePath` node to the first file_name node
      // in the chain created above, and an edge from the last node in the chain back to
      // the `aboveFilePath` node. When matching, we will start from the first node in
      // the chain, and continue following it to parent directories until there is an
      // edge pointing an `aboveFilePath` node that also points to the start of the chain.
      // This indicates a complete match, and any requests attached to the `aboveFilePath`
      // node will be invalidated.
      let firstId = 'file_name:' + parts[0];
      if (!this.hasEdge(node.id, firstId, 'invalidated_by_create_above')) {
        this.addEdge(node.id, firstId, 'invalidated_by_create_above');
      }

      invariant(last != null);
      if (!this.hasEdge(last.id, node.id, 'invalidated_by_create_above')) {
        this.addEdge(last.id, node.id, 'invalidated_by_create_above');
      }
    } else if (input.filePath != null) {
      node = nodeFromFilePath(input.filePath);
    } else {
      throw new Error('Invalid invalidation');
    }

    if (!this.hasNode(node.id)) {
      this.addNode(node);
    }

    if (!this.hasEdge(requestNode.id, node.id, 'invalidated_by_create')) {
      this.addEdge(requestNode.id, node.id, 'invalidated_by_create');
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
          case 'option':
            return {type: 'option', key: node.value.key};
        }
      })
      .filter(Boolean);
  }

  getSubRequests(requestId: string): Array<StoredRequest> {
    if (!this.hasNode(requestId)) {
      return [];
    }

    let requestNode = this.getRequestNode(requestId);
    let subRequests = this.getNodesConnectedFrom(requestNode, 'subrequest');

    return subRequests.map(node => {
      invariant(node.type === 'request');
      return node.value;
    });
  }

  invalidateFileNameNode(
    node: FileNameNode,
    filePath: FilePath,
    matchNodes: Array<FileNode>,
  ) {
    // If there is an edge between this file_name node and one of the original file nodes pointed to
    // by the original file_name node, and the matched node is inside the current directory, invalidate
    // all connected requests pointed to by the file node.
    let dirname = path.dirname(filePath);
    for (let matchNode of matchNodes) {
      if (
        this.hasEdge(node.id, matchNode.id, 'invalidated_by_create_above') &&
        isDirectoryInside(path.dirname(matchNode.value.filePath), dirname)
      ) {
        let connectedNodes = this.getNodesConnectedTo(
          matchNode,
          'invalidated_by_create',
        );
        for (let connectedNode of connectedNodes) {
          this.invalidateNode(connectedNode, FILE_CREATE);
        }
      }
    }

    // Find the `file_name` node for the parent directory and
    // recursively invalidate connected requests as described above.
    let basename = path.basename(dirname);
    let parent = this.getNode('file_name:' + basename);
    if (parent != null && this.hasEdge(node.id, parent.id, 'dirname')) {
      invariant(parent.type === 'file_name');
      this.invalidateFileNameNode(parent, dirname, matchNodes);
    }
  }

  respondToFSEvents(events: Array<Event>): boolean {
    let didInvalidate = false;
    for (let {path: filePath, type} of events) {
      let node = this.getNode(filePath);

      // sometimes mac os reports update events as create events.
      // if it was a create event, but the file already exists in the graph,
      // then also invalidate nodes connected by invalidated_by_update edges.
      if (node && (type === 'create' || type === 'update')) {
        let nodes = this.getNodesConnectedTo(node, 'invalidated_by_update');
        for (let connectedNode of nodes) {
          didInvalidate = true;
          this.invalidateNode(connectedNode, FILE_UPDATE);
        }

        if (type === 'create') {
          let nodes = this.getNodesConnectedTo(node, 'invalidated_by_create');
          for (let connectedNode of nodes) {
            didInvalidate = true;
            this.invalidateNode(connectedNode, FILE_CREATE);
          }
        }
      } else if (type === 'create') {
        let basename = path.basename(filePath);
        let fileNameNode = this.getNode('file_name:' + basename);
        if (fileNameNode?.type === 'file_name') {
          // Find potential file nodes to be invalidated if this file name pattern matches
          let above = this.getNodesConnectedTo(
            fileNameNode,
            'invalidated_by_create_above',
          ).map(node => {
            invariant(node.type === 'file');
            return node;
          });

          if (above.length > 0) {
            didInvalidate = true;
            this.invalidateFileNameNode(fileNameNode, filePath, above);
          }
        }

        for (let id of this.globNodeIds) {
          let globNode = this.getNode(id);
          invariant(globNode && globNode.type === 'glob');

          if (isGlobMatch(filePath, globNode.value)) {
            let connectedNodes = this.getNodesConnectedTo(
              globNode,
              'invalidated_by_create',
            );
            for (let connectedNode of connectedNodes) {
              didInvalidate = true;
              this.invalidateNode(connectedNode, FILE_CREATE);
            }
          }
        }
      } else if (node && type === 'delete') {
        for (let connectedNode of this.getNodesConnectedTo(
          node,
          'invalidated_by_delete',
        )) {
          didInvalidate = true;
          this.invalidateNode(connectedNode, FILE_DELETE);
        }
      }
    }

    return didInvalidate && this.invalidNodeIds.size > 0;
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
    let node = this.graph.getNode(id);
    if (node?.type === 'request') {
      node.invalidateReason = VALID;
    }
  }

  rejectRequest(id: string) {
    this.graph.incompleteNodeIds.delete(id);

    let node = this.graph.getNode(id);
    if (node?.type === 'request') {
      this.graph.invalidateNode(node, ERROR);
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
      let node = this.graph.getRequestNode(id);
      let result = await request.run({
        input: request.input,
        api,
        farm: this.farm,
        options: this.options,
        prevResult: await this.getRequestResult<TResult>(id),
        invalidateReason: node.invalidateReason,
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
    let invalidations = this.graph.getInvalidations(requestId);
    let api: RunAPI = {
      invalidateOnFileCreate: input =>
        this.graph.invalidateOnFileCreate(requestId, input),
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
      getInvalidations: () => invalidations,
      storeResult: (result, cacheKey) => {
        this.storeResult(requestId, result, cacheKey);
      },
      getSubRequests: () => this.graph.getSubRequests(requestId),
      getRequestResult: <T>(id): Async<?T> => this.getRequestResult<T>(id),
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
