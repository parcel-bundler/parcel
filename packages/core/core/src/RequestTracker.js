// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {Async, EnvMap} from '@parcel/types';
import type {EventType, Options as WatcherOptions} from '@parcel/watcher';
import type WorkerFarm from '@parcel/workers';
import type {ContentKey, NodeId, SerializedContentGraph} from '@parcel/graph';
import type {
  ParcelOptions,
  RequestInvalidation,
  InternalFileCreateInvalidation,
  InternalGlob,
} from './types';
import logger from '@parcel/logger';
import type {Deferred} from '@parcel/utils';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import {
  isGlobMatch,
  isDirectoryInside,
  makeDeferredWithPromise,
} from '@parcel/utils';
import {hashString} from '@parcel/rust';
import {NodeFS} from '@parcel/fs';
import {ContentGraph} from '@parcel/graph';
import {deserialize, serialize} from './serializer';
import {assertSignalNotAborted, hashFromOption, getCacheKey} from './utils';
import {
  type ProjectPath,
  fromProjectPathRelative,
  toProjectPathUnsafe,
  toProjectPath,
} from './projectPath';

import {
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

import {report} from './ReporterRunner';
import {PromiseQueue} from '@parcel/utils';
import type {Cache} from '@parcel/cache';

export const requestGraphEdgeTypes = {
  subrequest: 2,
  invalidated_by_update: 3,
  invalidated_by_delete: 4,
  invalidated_by_create: 5,
  invalidated_by_create_above: 6,
  dirname: 7,
};

export type RequestGraphEdgeType = $Values<typeof requestGraphEdgeTypes>;

type SerializedRequestGraph = {|
  ...SerializedContentGraph<RequestGraphNode, RequestGraphEdgeType>,
  invalidNodeIds: Set<NodeId>,
  incompleteNodeIds: Set<NodeId>,
  globNodeIds: Set<NodeId>,
  envNodeIds: Set<NodeId>,
  optionNodeIds: Set<NodeId>,
  unpredicatableNodeIds: Set<NodeId>,
  invalidateOnBuildNodeIds: Set<NodeId>,
  cachedRequestChunks: Set<number>,
|};

const FILE: 0 = 0;
const REQUEST: 1 = 1;
const FILE_NAME: 2 = 2;
const ENV: 3 = 3;
const OPTION: 4 = 4;
const GLOB: 5 = 5;
type FileNode = {|id: ContentKey, +type: typeof FILE|};

type GlobNode = {|id: ContentKey, +type: typeof GLOB, value: InternalGlob|};

type FileNameNode = {|
  id: ContentKey,
  +type: typeof FILE_NAME,
|};

type EnvNode = {|
  id: ContentKey,
  +type: typeof ENV,
  value: string | void,
|};

type OptionNode = {|
  id: ContentKey,
  +type: typeof OPTION,
  hash: string,
|};

type Request<TInput, TResult> = {|
  id: string,
  +type: RequestType,
  input: TInput,
  run: ({|input: TInput, ...StaticRunOpts<TResult>|}) => Async<TResult>,
|};

type InvalidateReason = number;
type RequestNode = {|
  id: ContentKey,
  +type: typeof REQUEST,
  +requestType: RequestType,
  invalidateReason: InvalidateReason,
  result?: mixed,
  resultCacheKey?: ?string,
  hash?: string,
|};

export const requestTypes = {
  parcel_build_request: 1,
  bundle_graph_request: 2,
  asset_graph_request: 3,
  entry_request: 4,
  target_request: 5,
  parcel_config_request: 6,
  path_request: 7,
  dev_dep_request: 8,
  asset_request: 9,
  config_request: 10,
  write_bundles_request: 11,
  package_request: 12,
  write_bundle_request: 13,
  validation_request: 14,
};

type RequestType = $Values<typeof requestTypes>;

type RequestGraphNode =
  | RequestNode
  | FileNode
  | GlobNode
  | FileNameNode
  | EnvNode
  | OptionNode;

export type RunAPI<TResult> = {|
  invalidateOnFileCreate: InternalFileCreateInvalidation => void,
  invalidateOnFileDelete: ProjectPath => void,
  invalidateOnFileUpdate: ProjectPath => void,
  invalidateOnStartup: () => void,
  invalidateOnBuild: () => void,
  invalidateOnEnvChange: string => void,
  invalidateOnOptionChange: string => void,
  getInvalidations(): Array<RequestInvalidation>,
  storeResult(result: TResult, cacheKey?: string): void,
  getRequestResult<T>(contentKey: ContentKey): Async<?T>,
  getPreviousResult<T>(ifMatch?: string): Async<?T>,
  getSubRequests(): Array<RequestNode>,
  getInvalidSubRequests(): Array<RequestNode>,
  canSkipSubrequest(ContentKey): boolean,
  runRequest: <TInput, TResult>(
    subRequest: Request<TInput, TResult>,
    opts?: RunRequestOpts,
  ) => Promise<TResult>,
|};

type RunRequestOpts = {|
  force: boolean,
|};

export type StaticRunOpts<TResult> = {|
  farm: WorkerFarm,
  options: ParcelOptions,
  api: RunAPI<TResult>,
  invalidateReason: InvalidateReason,
|};

const nodeFromFilePath = (filePath: ProjectPath): RequestGraphNode => ({
  id: fromProjectPathRelative(filePath),
  type: FILE,
});
const nodeFromGlob = (glob: InternalGlob): RequestGraphNode => ({
  id: fromProjectPathRelative(glob),
  type: GLOB,
  value: glob,
});
const nodeFromFileName = (fileName: string): RequestGraphNode => ({
  id: 'file_name:' + fileName,
  type: FILE_NAME,
});

const nodeFromRequest = (request: RequestNode): RequestGraphNode => ({
  id: request.id,
  type: REQUEST,
  requestType: request.requestType,
  invalidateReason: INITIAL_BUILD,
});

const nodeFromEnv = (env: string, value: string | void): RequestGraphNode => ({
  id: 'env:' + env,
  type: ENV,
  value,
});

const nodeFromOption = (option: string, value: mixed): RequestGraphNode => ({
  id: 'option:' + option,
  type: OPTION,
  hash: hashFromOption(value),
});

const keyFromEnvContentKey = (contentKey: string): string =>
  contentKey.slice('env:'.length);

const keyFromOptionContentKey = (contentKey: string): string =>
  contentKey.slice('option:'.length);

export class RequestGraph extends ContentGraph<
  RequestGraphNode,
  RequestGraphEdgeType,
> {
  invalidNodeIds: Set<NodeId> = new Set();
  incompleteNodeIds: Set<NodeId> = new Set();
  incompleteNodePromises: Map<NodeId, Promise<boolean>> = new Map();
  globNodeIds: Set<NodeId> = new Set();
  envNodeIds: Set<NodeId> = new Set();
  optionNodeIds: Set<NodeId> = new Set();
  // Unpredictable nodes are requests that cannot be predicted whether they should rerun based on
  // filesystem changes alone. They should rerun on each startup of Parcel.
  unpredicatableNodeIds: Set<NodeId> = new Set();
  invalidateOnBuildNodeIds: Set<NodeId> = new Set();
  cachedRequestChunks: Set<number> = new Set();

  // $FlowFixMe[prop-missing]
  static deserialize(opts: SerializedRequestGraph): RequestGraph {
    // $FlowFixMe
    let deserialized = new RequestGraph(opts);
    deserialized.invalidNodeIds = opts.invalidNodeIds;
    deserialized.incompleteNodeIds = opts.incompleteNodeIds;
    deserialized.globNodeIds = opts.globNodeIds;
    deserialized.envNodeIds = opts.envNodeIds;
    deserialized.optionNodeIds = opts.optionNodeIds;
    deserialized.unpredicatableNodeIds = opts.unpredicatableNodeIds;
    deserialized.invalidateOnBuildNodeIds = opts.invalidateOnBuildNodeIds;
    deserialized.cachedRequestChunks = opts.cachedRequestChunks;
    return deserialized;
  }

  // $FlowFixMe[prop-missing]
  serialize(): SerializedRequestGraph {
    return {
      ...super.serialize(),
      invalidNodeIds: this.invalidNodeIds,
      incompleteNodeIds: this.incompleteNodeIds,
      globNodeIds: this.globNodeIds,
      envNodeIds: this.envNodeIds,
      optionNodeIds: this.optionNodeIds,
      unpredicatableNodeIds: this.unpredicatableNodeIds,
      invalidateOnBuildNodeIds: this.invalidateOnBuildNodeIds,
      cachedRequestChunks: this.cachedRequestChunks,
    };
  }

  // addNode for RequestGraph should not override the value if added multiple times
  addNode(node: RequestGraphNode): NodeId {
    let nodeId = this._contentKeyToNodeId.get(node.id);
    if (nodeId != null) {
      return nodeId;
    }

    nodeId = super.addNodeByContentKey(node.id, node);
    if (node.type === GLOB) {
      this.globNodeIds.add(nodeId);
    } else if (node.type === ENV) {
      this.envNodeIds.add(nodeId);
    } else if (node.type === OPTION) {
      this.optionNodeIds.add(nodeId);
    }

    return nodeId;
  }

  removeNode(nodeId: NodeId): void {
    this.invalidNodeIds.delete(nodeId);
    this.incompleteNodeIds.delete(nodeId);
    this.incompleteNodePromises.delete(nodeId);
    this.unpredicatableNodeIds.delete(nodeId);
    this.invalidateOnBuildNodeIds.delete(nodeId);
    let node = nullthrows(this.getNode(nodeId));
    if (node.type === GLOB) {
      this.globNodeIds.delete(nodeId);
    } else if (node.type === ENV) {
      this.envNodeIds.delete(nodeId);
    } else if (node.type === OPTION) {
      this.optionNodeIds.delete(nodeId);
    }
    return super.removeNode(nodeId);
  }

  getRequestNode(nodeId: NodeId): RequestNode {
    let node = nullthrows(this.getNode(nodeId));
    invariant(node.type === REQUEST);
    return node;
  }

  replaceSubrequests(
    requestNodeId: NodeId,
    subrequestContentKeys: Array<ContentKey>,
  ) {
    let subrequestNodeIds = [];
    for (let key of subrequestContentKeys) {
      if (this.hasContentKey(key)) {
        subrequestNodeIds.push(this.getNodeIdByContentKey(key));
      }
    }

    this.replaceNodeIdsConnectedTo(
      requestNodeId,
      subrequestNodeIds,
      null,
      requestGraphEdgeTypes.subrequest,
    );
  }

  invalidateNode(nodeId: NodeId, reason: InvalidateReason) {
    let node = nullthrows(this.getNode(nodeId));
    invariant(node.type === REQUEST);
    node.invalidateReason |= reason;
    this.invalidNodeIds.add(nodeId);

    let parentNodes = this.getNodeIdsConnectedTo(
      nodeId,
      requestGraphEdgeTypes.subrequest,
    );
    for (let parentNode of parentNodes) {
      this.invalidateNode(parentNode, reason);
    }

    // If the node is invalidated, the cached request chunk on disk needs to be re-written
    this.removeCachedRequestChunkForNode(nodeId);
  }

  invalidateUnpredictableNodes() {
    for (let nodeId of this.unpredicatableNodeIds) {
      let node = nullthrows(this.getNode(nodeId));
      invariant(node.type !== FILE && node.type !== GLOB);
      this.invalidateNode(nodeId, STARTUP);
    }
  }

  invalidateOnBuildNodes() {
    for (let nodeId of this.invalidateOnBuildNodeIds) {
      let node = nullthrows(this.getNode(nodeId));
      invariant(node.type !== FILE && node.type !== GLOB);
      this.invalidateNode(nodeId, STARTUP);
    }
  }

  invalidateEnvNodes(env: EnvMap) {
    for (let nodeId of this.envNodeIds) {
      let node = nullthrows(this.getNode(nodeId));
      invariant(node.type === ENV && typeof node.id === 'string');
      if (env[keyFromEnvContentKey(node.id)] !== node.value) {
        let parentNodes = this.getNodeIdsConnectedTo(
          nodeId,
          requestGraphEdgeTypes.invalidated_by_update,
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
      invariant(node.type === OPTION && typeof node.id === 'string');
      if (
        hashFromOption(options[keyFromOptionContentKey(node.id)]) !== node.hash
      ) {
        let parentNodes = this.getNodeIdsConnectedTo(
          nodeId,
          requestGraphEdgeTypes.invalidated_by_update,
        );
        for (let parentNode of parentNodes) {
          this.invalidateNode(parentNode, OPTION_CHANGE);
        }
      }
    }
  }

  invalidateOnFileUpdate(requestNodeId: NodeId, filePath: ProjectPath) {
    let fileNodeId = this.addNode(nodeFromFilePath(filePath));

    if (
      !this.hasEdge(
        requestNodeId,
        fileNodeId,
        requestGraphEdgeTypes.invalidated_by_update,
      )
    ) {
      this.addEdge(
        requestNodeId,
        fileNodeId,
        requestGraphEdgeTypes.invalidated_by_update,
      );
    }
  }

  invalidateOnFileDelete(requestNodeId: NodeId, filePath: ProjectPath) {
    let fileNodeId = this.addNode(nodeFromFilePath(filePath));

    if (
      !this.hasEdge(
        requestNodeId,
        fileNodeId,
        requestGraphEdgeTypes.invalidated_by_delete,
      )
    ) {
      this.addEdge(
        requestNodeId,
        fileNodeId,
        requestGraphEdgeTypes.invalidated_by_delete,
      );
    }
  }

  invalidateOnFileCreate(
    requestNodeId: NodeId,
    input: InternalFileCreateInvalidation,
  ) {
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
      let lastNodeId;
      for (let part of parts) {
        let fileNameNode = nodeFromFileName(part);

        let fileNameNodeId = this.addNode(fileNameNode);
        if (
          lastNodeId != null &&
          !this.hasEdge(
            lastNodeId,
            fileNameNodeId,
            requestGraphEdgeTypes.dirname,
          )
        ) {
          this.addEdge(
            lastNodeId,
            fileNameNodeId,
            requestGraphEdgeTypes.dirname,
          );
        }

        lastNodeId = fileNameNodeId;
      }

      // The `aboveFilePath` condition asserts that requests are only invalidated
      // if the file being created is "above" it in the filesystem (e.g. the file
      // is created in a parent directory). There is likely to already be a node
      // for this file in the graph (e.g. the source file) that we can reuse for this.
      node = nodeFromFilePath(aboveFilePath);
      let nodeId = this.addNode(node);

      // Now create an edge from the `aboveFilePath` node to the first file_name node
      // in the chain created above, and an edge from the last node in the chain back to
      // the `aboveFilePath` node. When matching, we will start from the first node in
      // the chain, and continue following it to parent directories until there is an
      // edge pointing an `aboveFilePath` node that also points to the start of the chain.
      // This indicates a complete match, and any requests attached to the `aboveFilePath`
      // node will be invalidated.
      let firstId = 'file_name:' + parts[0];
      let firstNodeId = this.getNodeIdByContentKey(firstId);
      if (
        !this.hasEdge(
          nodeId,
          firstNodeId,
          requestGraphEdgeTypes.invalidated_by_create_above,
        )
      ) {
        this.addEdge(
          nodeId,
          firstNodeId,
          requestGraphEdgeTypes.invalidated_by_create_above,
        );
      }

      invariant(lastNodeId != null);
      if (
        !this.hasEdge(
          lastNodeId,
          nodeId,
          requestGraphEdgeTypes.invalidated_by_create_above,
        )
      ) {
        this.addEdge(
          lastNodeId,
          nodeId,
          requestGraphEdgeTypes.invalidated_by_create_above,
        );
      }
    } else if (input.filePath != null) {
      node = nodeFromFilePath(input.filePath);
    } else {
      throw new Error('Invalid invalidation');
    }

    let nodeId = this.addNode(node);
    if (
      !this.hasEdge(
        requestNodeId,
        nodeId,
        requestGraphEdgeTypes.invalidated_by_create,
      )
    ) {
      this.addEdge(
        requestNodeId,
        nodeId,
        requestGraphEdgeTypes.invalidated_by_create,
      );
    }
  }

  invalidateOnStartup(requestNodeId: NodeId) {
    this.getRequestNode(requestNodeId);
    this.unpredicatableNodeIds.add(requestNodeId);
  }

  invalidateOnBuild(requestNodeId: NodeId) {
    this.getRequestNode(requestNodeId);
    this.invalidateOnBuildNodeIds.add(requestNodeId);
  }

  invalidateOnEnvChange(
    requestNodeId: NodeId,
    env: string,
    value: string | void,
  ) {
    let envNode = nodeFromEnv(env, value);
    let envNodeId = this.addNode(envNode);

    if (
      !this.hasEdge(
        requestNodeId,
        envNodeId,
        requestGraphEdgeTypes.invalidated_by_update,
      )
    ) {
      this.addEdge(
        requestNodeId,
        envNodeId,
        requestGraphEdgeTypes.invalidated_by_update,
      );
    }
  }

  invalidateOnOptionChange(
    requestNodeId: NodeId,
    option: string,
    value: mixed,
  ) {
    let optionNode = nodeFromOption(option, value);
    let optionNodeId = this.addNode(optionNode);

    if (
      !this.hasEdge(
        requestNodeId,
        optionNodeId,
        requestGraphEdgeTypes.invalidated_by_update,
      )
    ) {
      this.addEdge(
        requestNodeId,
        optionNodeId,
        requestGraphEdgeTypes.invalidated_by_update,
      );
    }
  }

  clearInvalidations(nodeId: NodeId) {
    this.unpredicatableNodeIds.delete(nodeId);
    this.invalidateOnBuildNodeIds.delete(nodeId);
    this.replaceNodeIdsConnectedTo(
      nodeId,
      [],
      null,
      requestGraphEdgeTypes.invalidated_by_update,
    );
    this.replaceNodeIdsConnectedTo(
      nodeId,
      [],
      null,
      requestGraphEdgeTypes.invalidated_by_delete,
    );
    this.replaceNodeIdsConnectedTo(
      nodeId,
      [],
      null,
      requestGraphEdgeTypes.invalidated_by_create,
    );
  }

  getInvalidations(requestNodeId: NodeId): Array<RequestInvalidation> {
    if (!this.hasNode(requestNodeId)) {
      return [];
    }

    // For now just handling updates. Could add creates/deletes later if needed.
    let invalidations = this.getNodeIdsConnectedFrom(
      requestNodeId,
      requestGraphEdgeTypes.invalidated_by_update,
    );
    return invalidations
      .map(nodeId => {
        let node = nullthrows(this.getNode(nodeId));
        switch (node.type) {
          case FILE:
            invariant(typeof node.id === 'string');
            return {type: 'file', filePath: toProjectPathUnsafe(node.id)};
          case ENV:
            invariant(typeof node.id === 'string');
            return {type: 'env', key: keyFromEnvContentKey(node.id)};
          case OPTION:
            invariant(typeof node.id === 'string');
            return {
              type: 'option',
              key: keyFromOptionContentKey(node.id),
            };
        }
      })
      .filter(Boolean);
  }

  getSubRequests(requestNodeId: NodeId): Array<RequestNode> {
    if (!this.hasNode(requestNodeId)) {
      return [];
    }

    let subRequests = this.getNodeIdsConnectedFrom(
      requestNodeId,
      requestGraphEdgeTypes.subrequest,
    );

    return subRequests.map(nodeId => {
      let node = nullthrows(this.getNode(nodeId));
      invariant(node.type === REQUEST);
      return node;
    });
  }

  getInvalidSubRequests(requestNodeId: NodeId): Array<RequestNode> {
    if (!this.hasNode(requestNodeId)) {
      return [];
    }

    let subRequests = this.getNodeIdsConnectedFrom(
      requestNodeId,
      requestGraphEdgeTypes.subrequest,
    );

    return subRequests
      .filter(id => this.invalidNodeIds.has(id))
      .map(nodeId => {
        let node = nullthrows(this.getNode(nodeId));
        invariant(node.type === REQUEST);
        return node;
      });
  }

  invalidateFileNameNode(
    node: FileNameNode,
    filePath: ProjectPath,
    matchNodes: Array<FileNode>,
  ) {
    // If there is an edge between this file_name node and one of the original file nodes pointed to
    // by the original file_name node, and the matched node is inside the current directory, invalidate
    // all connected requests pointed to by the file node.
    let dirname = path.dirname(fromProjectPathRelative(filePath));

    let nodeId = this.getNodeIdByContentKey(node.id);
    for (let matchNode of matchNodes) {
      let matchNodeId = this.getNodeIdByContentKey(matchNode.id);
      if (
        this.hasEdge(
          nodeId,
          matchNodeId,
          requestGraphEdgeTypes.invalidated_by_create_above,
        ) &&
        typeof matchNode.id === 'string' &&
        isDirectoryInside(
          fromProjectPathRelative(toProjectPathUnsafe(matchNode.id)),
          dirname,
        )
      ) {
        let connectedNodes = this.getNodeIdsConnectedTo(
          matchNodeId,
          requestGraphEdgeTypes.invalidated_by_create,
        );
        for (let connectedNode of connectedNodes) {
          this.invalidateNode(connectedNode, FILE_CREATE);
        }
      }
    }

    // Find the `file_name` node for the parent directory and
    // recursively invalidate connected requests as described above.
    let basename = path.basename(dirname);
    let contentKey = 'file_name:' + basename;
    if (this.hasContentKey(contentKey)) {
      if (
        this.hasEdge(
          nodeId,
          this.getNodeIdByContentKey(contentKey),
          requestGraphEdgeTypes.dirname,
        )
      ) {
        let parent = nullthrows(this.getNodeByContentKey(contentKey));
        invariant(parent.type === FILE_NAME);
        this.invalidateFileNameNode(
          parent,
          toProjectPathUnsafe(dirname),
          matchNodes,
        );
      }
    }
  }

  respondToFSEvents(
    events: Array<{|path: ProjectPath, type: EventType|}>,
  ): boolean {
    let didInvalidate = false;
    for (let {path: _filePath, type} of events) {
      let filePath = fromProjectPathRelative(_filePath);
      let hasFileRequest = this.hasContentKey(filePath);

      // If we see a 'create' event for the project root itself,
      // this means the project root was moved and we need to
      // re-run all requests.
      if (type === 'create' && filePath === '') {
        // $FlowFixMe(incompatible-call) `trackableEvent` isn't part of the Diagnostic interface
        logger.verbose({
          origin: '@parcel/core',
          message:
            'Watcher reported project root create event. Invalidate all nodes.',
          trackableEvent: 'project_root_create',
        });
        for (let [id, node] of this.nodes.entries()) {
          if (node?.type === REQUEST) {
            this.invalidNodeIds.add(id);
          }
        }
        return true;
      }

      // sometimes mac os reports update events as create events.
      // if it was a create event, but the file already exists in the graph,
      // then also invalidate nodes connected by invalidated_by_update edges.
      if (hasFileRequest && (type === 'create' || type === 'update')) {
        let nodeId = this.getNodeIdByContentKey(filePath);
        let nodes = this.getNodeIdsConnectedTo(
          nodeId,
          requestGraphEdgeTypes.invalidated_by_update,
        );

        for (let connectedNode of nodes) {
          didInvalidate = true;
          this.invalidateNode(connectedNode, FILE_UPDATE);
        }

        if (type === 'create') {
          let nodes = this.getNodeIdsConnectedTo(
            nodeId,
            requestGraphEdgeTypes.invalidated_by_create,
          );
          for (let connectedNode of nodes) {
            didInvalidate = true;
            this.invalidateNode(connectedNode, FILE_CREATE);
          }
        }
      } else if (type === 'create') {
        let basename = path.basename(filePath);
        let fileNameNode = this.getNodeByContentKey('file_name:' + basename);
        if (fileNameNode != null && fileNameNode.type === FILE_NAME) {
          let fileNameNodeId = this.getNodeIdByContentKey(
            'file_name:' + basename,
          );

          // Find potential file nodes to be invalidated if this file name pattern matches
          let above: Array<FileNode> = [];
          for (const nodeId of this.getNodeIdsConnectedTo(
            fileNameNodeId,
            requestGraphEdgeTypes.invalidated_by_create_above,
          )) {
            let node = nullthrows(this.getNode(nodeId));
            // these might also be `glob` nodes which get handled below, we only care about files here.
            if (node.type === FILE) {
              above.push(node);
            }
          }

          if (above.length > 0) {
            didInvalidate = true;
            this.invalidateFileNameNode(fileNameNode, _filePath, above);
          }
        }

        for (let globeNodeId of this.globNodeIds) {
          let globNode = this.getNode(globeNodeId);
          invariant(globNode && globNode.type === GLOB);

          if (isGlobMatch(filePath, fromProjectPathRelative(globNode.value))) {
            let connectedNodes = this.getNodeIdsConnectedTo(
              globeNodeId,
              requestGraphEdgeTypes.invalidated_by_create,
            );
            for (let connectedNode of connectedNodes) {
              didInvalidate = true;
              this.invalidateNode(connectedNode, FILE_CREATE);
            }
          }
        }
      } else if (hasFileRequest && type === 'delete') {
        let nodeId = this.getNodeIdByContentKey(filePath);
        for (let connectedNode of this.getNodeIdsConnectedTo(
          nodeId,
          requestGraphEdgeTypes.invalidated_by_delete,
        )) {
          didInvalidate = true;
          this.invalidateNode(connectedNode, FILE_DELETE);
        }

        // Delete the file node since it doesn't exist anymore.
        // This ensures that files that don't exist aren't sent
        // to requests as invalidations for future requests.
        this.removeNode(nodeId);
      }
    }

    return didInvalidate && this.invalidNodeIds.size > 0;
  }

  hasCachedRequestChunk(index: number): boolean {
    return this.cachedRequestChunks.has(index);
  }

  setCachedRequestChunk(index: number): void {
    this.cachedRequestChunks.add(index);
  }

  removeCachedRequestChunkForNode(nodeId: number): void {
    this.cachedRequestChunks.delete(Math.floor(nodeId / NODES_PER_BLOB));
  }
}

// This constant is chosen by local profiling the time to serialise n nodes and tuning until an average time of ~50 ms per blob.
// The goal is to free up the event loop periodically to allow interruption by the user.
const NODES_PER_BLOB = 2 ** 14;

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

  startRequest(request: RequestNode): {|
    requestNodeId: NodeId,
    deferred: Deferred<boolean>,
  |} {
    let didPreviouslyExist = this.graph.hasContentKey(request.id);
    let requestNodeId;
    if (didPreviouslyExist) {
      requestNodeId = this.graph.getNodeIdByContentKey(request.id);
      // Clear existing invalidations for the request so that the new
      // invalidations created during the request replace the existing ones.
      this.graph.clearInvalidations(requestNodeId);
    } else {
      requestNodeId = this.graph.addNode(nodeFromRequest(request));
    }

    this.graph.incompleteNodeIds.add(requestNodeId);
    this.graph.invalidNodeIds.delete(requestNodeId);

    let {promise, deferred} = makeDeferredWithPromise();
    this.graph.incompleteNodePromises.set(requestNodeId, promise);

    return {requestNodeId, deferred};
  }

  // If a cache key is provided, the result will be removed from the node and stored in a separate cache entry
  storeResult(nodeId: NodeId, result: mixed, cacheKey: ?string) {
    let node = this.graph.getNode(nodeId);
    if (node && node.type === REQUEST) {
      node.result = result;
      node.resultCacheKey = cacheKey;
    }
  }

  hasValidResult(nodeId: NodeId): boolean {
    return (
      this.graph.hasNode(nodeId) &&
      !this.graph.invalidNodeIds.has(nodeId) &&
      !this.graph.incompleteNodeIds.has(nodeId)
    );
  }

  async getRequestResult<T>(
    contentKey: ContentKey,
    ifMatch?: string,
  ): Promise<?T> {
    let node = nullthrows(this.graph.getNodeByContentKey(contentKey));
    invariant(node.type === REQUEST);

    if (ifMatch != null && node.resultCacheKey !== ifMatch) {
      return null;
    }

    if (node.result != undefined) {
      // $FlowFixMe
      let result: T = (node.result: any);
      return result;
    } else if (node.resultCacheKey != null && ifMatch == null) {
      let key = node.resultCacheKey;
      invariant(this.options.cache.hasLargeBlob(key));
      let cachedResult: T = deserialize(
        await this.options.cache.getLargeBlob(key),
        this.options.db,
      );
      node.result = cachedResult;
      return cachedResult;
    }
  }

  completeRequest(nodeId: NodeId) {
    this.graph.invalidNodeIds.delete(nodeId);
    this.graph.incompleteNodeIds.delete(nodeId);
    this.graph.incompleteNodePromises.delete(nodeId);
    let node = this.graph.getNode(nodeId);
    if (node && node.type === REQUEST) {
      node.invalidateReason = VALID;
    }
    this.graph.removeCachedRequestChunkForNode(nodeId);
  }

  rejectRequest(nodeId: NodeId) {
    this.graph.incompleteNodeIds.delete(nodeId);
    this.graph.incompleteNodePromises.delete(nodeId);

    let node = this.graph.getNode(nodeId);
    if (node?.type === REQUEST) {
      this.graph.invalidateNode(nodeId, ERROR);
    }
  }

  respondToFSEvents(
    events: Array<{|path: ProjectPath, type: EventType|}>,
  ): boolean {
    return this.graph.respondToFSEvents(events);
  }

  hasInvalidRequests(): boolean {
    return this.graph.invalidNodeIds.size > 0;
  }

  getInvalidRequests(): Array<RequestNode> {
    let invalidRequests = [];
    for (let id of this.graph.invalidNodeIds) {
      let node = nullthrows(this.graph.getNode(id));
      invariant(node.type === REQUEST);
      invalidRequests.push(node);
    }
    return invalidRequests;
  }

  replaceSubrequests(
    requestNodeId: NodeId,
    subrequestContextKeys: Array<ContentKey>,
  ) {
    this.graph.replaceSubrequests(requestNodeId, subrequestContextKeys);
  }

  async runRequest<TInput, TResult>(
    request: Request<TInput, TResult>,
    opts?: ?RunRequestOpts,
  ): Promise<TResult> {
    let requestId = this.graph.hasContentKey(request.id)
      ? this.graph.getNodeIdByContentKey(request.id)
      : undefined;
    let hasValidResult = requestId != null && this.hasValidResult(requestId);

    if (!opts?.force && hasValidResult) {
      // $FlowFixMe[incompatible-type]
      return this.getRequestResult<TResult>(request.id);
    }

    if (requestId != null) {
      let incompletePromise = this.graph.incompleteNodePromises.get(requestId);
      if (incompletePromise != null) {
        // There is a another instance of this request already running, wait for its completion and reuse its result
        try {
          if (await incompletePromise) {
            // $FlowFixMe[incompatible-type]
            return this.getRequestResult<TResult>(request.id);
          }
        } catch (e) {
          // Rerun this request
        }
      }
    }

    let previousInvalidations =
      requestId != null ? this.graph.getInvalidations(requestId) : [];
    let {requestNodeId, deferred} = this.startRequest({
      id: request.id,
      type: REQUEST,
      requestType: request.type,
      invalidateReason: INITIAL_BUILD,
    });

    let {api, subRequestContentKeys} = this.createAPI(
      requestNodeId,
      previousInvalidations,
    );

    try {
      let node = this.graph.getRequestNode(requestNodeId);
      let result = await request.run({
        input: request.input,
        api,
        farm: this.farm,
        options: this.options,
        invalidateReason: node.invalidateReason,
      });

      assertSignalNotAborted(this.signal);
      this.completeRequest(requestNodeId);

      deferred.resolve(true);
      return result;
    } catch (err) {
      this.rejectRequest(requestNodeId);
      deferred.resolve(false);
      throw err;
    } finally {
      this.graph.replaceSubrequests(requestNodeId, [...subRequestContentKeys]);
    }
  }

  createAPI<TResult>(
    requestId: NodeId,
    previousInvalidations: Array<RequestInvalidation>,
  ): {|api: RunAPI<TResult>, subRequestContentKeys: Set<ContentKey>|} {
    let subRequestContentKeys = new Set<ContentKey>();
    let api: RunAPI<TResult> = {
      invalidateOnFileCreate: input =>
        this.graph.invalidateOnFileCreate(requestId, input),
      invalidateOnFileDelete: filePath =>
        this.graph.invalidateOnFileDelete(requestId, filePath),
      invalidateOnFileUpdate: filePath =>
        this.graph.invalidateOnFileUpdate(requestId, filePath),
      invalidateOnStartup: () => this.graph.invalidateOnStartup(requestId),
      invalidateOnBuild: () => this.graph.invalidateOnBuild(requestId),
      invalidateOnEnvChange: env =>
        this.graph.invalidateOnEnvChange(requestId, env, this.options.env[env]),
      invalidateOnOptionChange: option =>
        this.graph.invalidateOnOptionChange(
          requestId,
          option,
          this.options[option],
        ),
      getInvalidations: () => previousInvalidations,
      storeResult: (result, cacheKey) => {
        this.storeResult(requestId, result, cacheKey);
      },
      getSubRequests: () => this.graph.getSubRequests(requestId),
      getInvalidSubRequests: () => this.graph.getInvalidSubRequests(requestId),
      getPreviousResult: <T>(ifMatch?: string): Async<?T> => {
        let contentKey = nullthrows(this.graph.getNode(requestId)?.id);
        return this.getRequestResult<T>(contentKey, ifMatch);
      },
      getRequestResult: <T>(id): Async<?T> => this.getRequestResult<T>(id),
      canSkipSubrequest: contentKey => {
        if (
          this.graph.hasContentKey(contentKey) &&
          this.hasValidResult(this.graph.getNodeIdByContentKey(contentKey))
        ) {
          subRequestContentKeys.add(contentKey);
          return true;
        }

        return false;
      },
      runRequest: <TInput, TResult>(
        subRequest: Request<TInput, TResult>,
        opts?: RunRequestOpts,
      ): Promise<TResult> => {
        subRequestContentKeys.add(subRequest.id);
        return this.runRequest<TInput, TResult>(subRequest, opts);
      },
    };

    return {api, subRequestContentKeys};
  }

  async writeToCache(signal?: AbortSignal) {
    if (this.options.shouldDisableCache) {
      return;
    }

    let cacheKey = getCacheKey(this.options);
    let requestGraphKey = `requestGraph-${cacheKey}`;
    let snapshotKey = `snapshot-${cacheKey}`;
    let dbKey = `parceldb-${cacheKey}`;

    let serialisedGraph = this.graph.serialize();
    let total = 0;

    const serialiseAndSet = async (
      key: string,
      // $FlowFixMe serialise input is any type
      contents: any,
    ): Promise<void> => {
      if (signal?.aborted) {
        throw new Error('Serialization was aborted');
      }

      await this.options.cache.setLargeBlob(key, serialize(contents), {signal});

      total += 1;

      report({
        type: 'cache',
        phase: 'write',
        total,
        size: this.graph.nodes.length,
      });
    };

    let queue = new PromiseQueue({
      maxConcurrent: 32,
    });

    report({
      type: 'cache',
      phase: 'start',
      total,
      size: this.graph.nodes.length,
    });

    // Preallocating a sparse array is faster than pushing when N is high enough
    let cacheableNodes = new Array(serialisedGraph.nodes.length);
    for (let i = 0; i < serialisedGraph.nodes.length; i += 1) {
      let node = serialisedGraph.nodes[i];

      let resultCacheKey = node?.resultCacheKey;
      if (
        node?.type === REQUEST &&
        resultCacheKey != null &&
        node?.result != null
      ) {
        queue
          .add(() => serialiseAndSet(resultCacheKey, node.result))
          .catch(() => {
            // Handle promise rejection
          });

        // eslint-disable-next-line no-unused-vars
        let {result: _, ...newNode} = node;
        cacheableNodes[i] = newNode;
      } else {
        cacheableNodes[i] = node;
      }
    }

    for (let i = 0; i * NODES_PER_BLOB < cacheableNodes.length; i += 1) {
      if (!this.graph.hasCachedRequestChunk(i)) {
        // We assume the request graph nodes are immutable and won't change
        queue
          .add(() =>
            serialiseAndSet(
              getRequestGraphNodeKey(i, cacheKey),
              cacheableNodes.slice(
                i * NODES_PER_BLOB,
                (i + 1) * NODES_PER_BLOB,
              ),
            ).then(() => {
              // Succeeded in writing to disk, save that we have completed this chunk
              this.graph.setCachedRequestChunk(i);
            }),
          )
          .catch(() => {
            // Handle promise rejection
          });
      }
    }

    queue
      .add(() =>
        serialiseAndSet(requestGraphKey, {
          ...serialisedGraph,
          nodes: undefined,
        }),
      )
      .catch(() => {
        // Handle promise rejection
      });

    let opts = getWatcherOptions(this.options);
    let snapshotPath = path.join(this.options.cacheDir, snapshotKey + '.txt');
    queue
      .add(() =>
        this.options.inputFS.writeSnapshot(
          this.options.projectRoot,
          snapshotPath,
          opts,
        ),
      )
      .catch(() => {
        // Handle promise rejection
      });

    try {
      await queue.run();
    } catch (err) {
      // If we have aborted, ignore the error and continue
      if (!signal?.aborted) throw err;
    }

    if (this.options.outputFS instanceof NodeFS) {
      let cachePath = path.join(this.options.cacheDir, dbKey);
      this.options.db.write(cachePath);
    } else {
      let buffer = this.options.db.toBuffer();
      await this.options.cache.setLargeBlob(dbKey, buffer, {signal});
    }

    report({type: 'cache', phase: 'end', total, size: this.graph.nodes.length});
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

function getRequestGraphNodeKey(index: number, cacheKey: string) {
  return `requestGraph-nodes-${index}-${cacheKey}`;
}

export async function readAndDeserializeRequestGraph(
  cache: Cache,
  requestGraphKey: string,
  cacheKey: string,
): Async<{|requestGraph: RequestGraph, bufferLength: number|}> {
  let bufferLength = 0;
  const getAndDeserialize = async (key: string) => {
    let buffer = await cache.getLargeBlob(key);
    bufferLength += Buffer.byteLength(buffer);
    return deserialize(buffer);
  };

  let i = 0;
  let nodePromises = [];
  while (await cache.hasLargeBlob(getRequestGraphNodeKey(i, cacheKey))) {
    nodePromises.push(getAndDeserialize(getRequestGraphNodeKey(i, cacheKey)));
    i += 1;
  }

  let serializedRequestGraph = await getAndDeserialize(requestGraphKey);

  return {
    requestGraph: RequestGraph.deserialize({
      ...serializedRequestGraph,
      nodes: (await Promise.all(nodePromises)).flatMap(nodeChunk => nodeChunk),
    }),
    // This is used inside parcel query for `.inspectCache`
    bufferLength,
  };
}

async function loadRequestGraph(options): Async<RequestGraph> {
  if (options.shouldDisableCache) {
    return new RequestGraph();
  }

  let cacheKey = getCacheKey(options);
  let requestGraphKey = `requestGraph-${cacheKey}`;

  if (await options.cache.hasLargeBlob(requestGraphKey)) {
    let {requestGraph} = await readAndDeserializeRequestGraph(
      options.cache,
      requestGraphKey,
      cacheKey,
    );

    let opts = getWatcherOptions(options);
    let snapshotKey = `snapshot-${cacheKey}`;
    let snapshotPath = path.join(options.cacheDir, snapshotKey + '.txt');
    let events = await options.inputFS.getEventsSince(
      options.watchDir,
      snapshotPath,
      opts,
    );

    requestGraph.invalidateUnpredictableNodes();
    requestGraph.invalidateOnBuildNodes();
    requestGraph.invalidateEnvNodes(options.env);
    requestGraph.invalidateOptionNodes(options);
    requestGraph.respondToFSEvents(
      (options.unstableFileInvalidations || events).map(e => ({
        type: e.type,
        path: toProjectPath(options.projectRoot, e.path),
      })),
    );

    return requestGraph;
  }

  return new RequestGraph();
}
