import {
  AbortController,
  type AbortSignal
} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import WorkerFarm from '@parcel/workers';
import {localResolve} from '@parcel/utils/src/localRequire';
import PromiseQueue from '@parcel/utils/src/PromiseQueue';
import {md5FromString} from '@parcel/utils/src/md5';
import {isGlob} from '@parcel/utils/src/glob';
import {isMatch} from 'micromatch';
import invariant from 'assert';
import Graph from './Graph';
import ConfigLoader from './ConfigLoader';
import ResolverRunner from './ResolverRunner';
import Dependency from './Dependency';

import type {
  Asset,
  CacheEntry,
  Dependency as IDependency,
  File,
  FilePath,
  GraphTraversalCallback,
  ParcelOptions,
  Target,
  TransformerRequest
} from '@parcel/types';
import type {AssetGraphNode, DependencyNode, FileNode, NodeId} from './types';

type Opts = {|
  options: ParcelOptions,
  entries?: Array<string>,
  targets?: Array<Target>,
  transformerRequest?: TransformerRequest,
  rootDir: FilePath
|};

// TODO: add abort stuff back in
// TODO: transformerRequest -> transformationRequest
// TODO: all type strings should be reusable constants
// TODO: clear out sub tasks inProgress?
// TODO: don't enqueue in progress on first run as the inprogress tasks have never started and therefore were not cancelled

export const TRANSFORMATION_REQUEST = 'TRANSFORMATION_REQUEST';
export const DEPENDENCY_REQUEST = 'DEPENDENCY_REQUEST';
export const CONFIG_REQUEST = 'CONFIG_REQUEST';
export const DEV_DEP_REQUEST = 'DEV_DEP_REQUEST';

export default class NewAssetGraph extends Graph {
  inProgress: Map<NodeId, Promise<any>> = new Map();
  invalidNodes: Map<NodeId, AssetGraphNode> = new Map();

  constructor(opts: Opts = {}) {
    let {options} = opts;
    super(opts);
    this.options = options;
    this.queue = new PromiseQueue();
    this.resolverRunner = new ResolverRunner({
      options
    });
    this.configLoader = new ConfigLoader(this.options);
  }

  static setup({
    entries,
    targets,
    rootNode = new RootNode(),
    transformerRequest,
    options
  }) {
    let graph = new NewAssetGraph({options});
    graph.building = true;

    graph.setRootNode(rootNode);

    let nodes = [];
    if (entries) {
      if (!targets) {
        throw new Error('Targets are required when entries are specified');
      }

      for (let entry of entries) {
        for (let target of targets) {
          let node = nodeFromDep(
            new Dependency({
              moduleSpecifier: entry,
              target: target,
              env: target.env,
              isEntry: true
            })
          );

          nodes.push(node);
        }
      }
    } else if (transformerRequest) {
      let node = nodeFromTransformerRequest(transformerRequest);
      nodes.push(node);
    }

    graph.replaceNodesConnectedTo(rootNode, nodes, 'has_entry');

    return graph;
  }

  async initFarm() {
    // This expects the worker farm to already be initialized by Parcel prior to calling
    // AssetGraphBuilder, which avoids needing to pass the options through here.
    this.farm = await WorkerFarm.getShared();
    this.runTransform = this.farm.mkhandle('runTransform');
    this.loadConfigHandle = WorkerFarm.createHandle(this.loadConfig.bind(this));
  }

  async build() {
    try {
      this.building = true;
      if (!this.farm) {
        await this.initFarm();
      }

      // TODO: Move this to `Parcel.js` so we can cancel bundling and packaging too
      if (this.controller) {
        this.controller.abort();
      }
      this.controller = new AbortController();
      let signal = this.controller.signal;

      this.changedAssets = new Map();

      if (this.invalidNodes.size) {
        this.queueMainTasksFromNodes(this.invalidNodes.values());
      }

      if (this.inProgress.size) {
        let incompleteNodes = Array.from(this.inProgress.keys()).map(id =>
          this.getNode(id)
        );
        this.queueMainTasksFromNodes(incompleteNodes);
      }

      await this.queue.run();
    } catch (e) {
      throw e;
    } finally {
      this.building = false;
    }
  }

  queueMainTasksFromNodes(nodes) {
    for (let node of nodes) {
      if (
        node.type === TRANSFORMATION_REQUEST ||
        node.type === DEPENDENCY_REQUEST
      ) {
        this.processNode(node);
      }
    }
  }

  addNode(node) {
    // TODO: this is hacky, having a separate skinny graph would probably fix this
    this.building && this.processNode(node);

    return super.addNode(node);
  }

  async loadConfig(configRequest, actionNode) {
    let configRequestNode = nodeFromConfigRequest(configRequest);
    let edge = {from: actionNode.id, to: configRequestNode.id, type: 'spawns'};
    if (!this.hasNode(configRequestNode)) this.addNode(configRequestNode);
    if (!this.hasEdge(edge)) this.addEdge(edge);

    let config = await this.getSubTaskResult(configRequestNode);

    await Promise.all(
      config.getDevDepRequests().map(async devDepRequest => {
        let devDepRequestNode = nodeFromDevDepRequest(devDepRequest);
        let {version} = await this.getSubTaskResult(devDepRequestNode);
        config.setDevDep(devDepRequest.moduleSpecifier, version);
      })
    );

    return config;
  }

  async getSubTaskResult(requestNode) {
    let result;
    if (this.inProgress.has(requestNode.id)) {
      result = await this.inProgress.get(requestNode.id);
    } else if (this.invalidNodes.has(requestNode.id)) {
      result = this.processNode(requestNode);
    } else {
      result = this.getResultFromGraph(requestNode);
    }

    return result;
  }

  async processNode(requestNode) {
    let {id, value: request} = requestNode;

    let promise;
    switch (requestNode.type) {
      // Main tasks:
      case TRANSFORMATION_REQUEST:
        promise = this.queue.add(() =>
          this.runTransformationRequest(requestNode)
        );
        break;
      case DEPENDENCY_REQUEST:
        promise = this.queue.add(() => this.runDependencyRequest(requestNode));
        break;
      // Sub tasks:
      case CONFIG_REQUEST:
        promise = this.runConfigRequest(requestNode);
        break;
      case DEV_DEP_REQUEST:
        promise = this.runDevDepRequest(requestNode);
        break;
      default:
        return;
    }

    try {
      this.inProgress.set(id, promise);
      let result = await promise;
      // ? Do either or both of these need to be deleted in the failure scenario?
      this.invalidNodes.delete(id);
      this.inProgress.delete(id);

      return result;
    } catch (e) {
      // Do nothing
      // Main tasks will caught by the queue
      // Sub tasks will end up rejecting the main task promise
    }
  }

  async runTransformationRequest(requestNode) {
    let {value: request} = requestNode;
    // console.log('TRANSFORMING', request);
    let start = Date.now();

    let assets = await this.runTransform({
      request,
      node: requestNode,
      loadConfig: this.loadConfigHandle,
      options: this.options
    });

    let time = Date.now() - start;
    for (let asset of assets) {
      asset.stats.time = time;
      this.changedAssets.set(asset.id, asset);
    }

    this.addTransformationResultToGraph(requestNode, assets);

    return assets;
  }

  async runDependencyRequest(requestNode) {
    let {value: request} = requestNode;
    // console.log('RESOLVING', request);
    let resolvedPath;
    try {
      resolvedPath = await this.resolverRunner.resolve(request);
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' && request.isOptional) {
        return;
      }

      throw err;
    }

    let req = {filePath: resolvedPath, env: request.env};

    this.addDependencyResultToGraph(requestNode, req);

    // ? Is this right?
    return req;
  }

  async runConfigRequest(requestNode) {
    let {value: request} = requestNode;
    // console.log('LOADING CONFIG', request);
    let result = await this.configLoader.load(request);
    this.addConfigResultToGraph(requestNode, result);
    return result;
  }

  async runDevDepRequest(requestNode) {
    let {value: request} = requestNode;
    // console.log('RESOLVING DEV DEP', request);
    let {moduleSpecifier, resolveFrom} = request;
    let [resolvedPath, resolvedPkg] = await localResolve(
      // TODO: localResolve has a cache that should either not be used or cleared appropriately
      `${moduleSpecifier}/package.json`,
      `${resolveFrom}/index`
    );
    let {name, version} = resolvedPkg;

    this.addDevDepResultToGraph(requestNode, {name, version});

    return {name, version};
  }

  // TODO: maybe clean up adding invalidatons?
  addTransformationResultToGraph(requestNode, assets) {
    let {value: request} = requestNode;
    // Get connected files from each asset and connect them to the file node
    let fileNodes = [];
    // TODO: Reimplement connected files, they should now only be used for source files (not config)
    // for (let asset of cacheEntry.assets) {
    //   let files = asset.getConnectedFiles().map(file => nodeFromFile(file));
    //   fileNodes = fileNodes.concat(files);
    // }

    // Add a file node for the file that the transformer request resolved to
    fileNodes.push(
      nodeFromFile({
        filePath: request.filePath
      })
    );

    let assetNodes = assets.map(asset => nodeFromAsset(asset));
    this.replaceNodesConnectedTo(requestNode, assetNodes, 'produces');
    // TODO: maybe add TransformationRequest with getInvalidations method
    this.replaceNodesConnectedTo(
      requestNode,
      fileNodes,
      'invalidated_by_change_to'
    );
    this.replaceNodesConnectedTo(
      requestNode,
      fileNodes,
      'invalidated_by_removal_of'
    );

    for (let assetNode of assetNodes) {
      let depNodes = assetNode.value
        .getDependencies()
        .map(dep => nodeFromDep(dep));
      this.replaceNodesConnectedTo(assetNode, depNodes, 'spawns');
    }
  }

  addDependencyResultToGraph(depRequestNode, result) {
    let transformationRequestNode = nodeFromTransformerRequest(result);
    this.replaceNodesConnectedTo(
      depRequestNode,
      [transformationRequestNode],
      'spawns'
    );
  }

  addConfigResultToGraph(configRequestNode, config) {
    let configNode = nodeFromConfig(config);
    this.replaceNodesConnectedTo(configRequestNode, [configNode], 'produces');

    let invalidationConnections = {
      invalidated_by_change_to: [],
      invalidated_by_addition_matching: [],
      invalidated_by_removal_of: []
    };
    for (let {action, pattern} of config.getInvalidations()) {
      let invalidateNode = isGlob(pattern)
        ? nodeFromGlob(pattern)
        : nodeFromFile({filePath: pattern});

      let edgeType = getInvalidationEdgeType(action);
      invalidationConnections[edgeType].push(invalidateNode);
    }

    for (let [edgeType, nodes] of Object.entries(invalidationConnections)) {
      this.replaceNodesConnectedTo(configRequestNode, nodes, edgeType);
    }

    let devDepRequestNodes = [];
    for (let devDepRequest of config.getDevDepRequests()) {
      let devDepRequestNode = nodeFromDevDepRequest(devDepRequest);
      devDepRequestNodes.push(devDepRequestNode);
    }

    this.replaceNodesConnectedTo(
      configRequestNode,
      devDepRequestNodes,
      'spawns'
    );
  }

  addDevDepResultToGraph(devDepRequestNode, devDep) {
    let devDepNode = nodeFromDevDep(devDep);
    this.replaceNodesConnectedTo(
      devDepRequestNode,
      [devDepNode],
      'resolves_to'
    );
  }

  getResultFromGraph(requestNode) {
    let result;
    switch (requestNode.type) {
      case TRANSFORMATION_REQUEST:
        result = this.getTransformationResultFromGraph(requestNode);
        break;
      case DEPENDENCY_REQUEST:
        result = this.getDependencyResultFromGraph(requestNode);
        break;
      case CONFIG_REQUEST:
        result = this.getConfigResultFromGraph(requestNode);
        break;
      case DEV_DEP_REQUEST:
        result = this.getDevDepResultFromGraph(requestNode);
        break;
    }

    return result;
  }

  getTransformationResultFromGraph() {
    // TODO: implement
  }

  getDependencyResultFromGraph() {
    // TODO: implement
  }

  getConfigResultFromGraph(configRequestNode) {
    let [configNode] = this.getNodesConnectedTo(configRequestNode, 'produces');

    if (!configNode) {
      let err = new Error('Could not find config result for config request');
      err.configRequest = configRequestNode.value;
      throw err;
    }

    return configNode.value;
  }

  getDevDepResultFromGraph(devDepRequestNode) {
    let [devDepNode] = this.getNodesConnectedFrom(
      devDepRequestNode,
      'resolves_to'
    );

    if (!devDepNode) {
      let err = new Error('Could not find config result for dev dep request');
      err.devDepRequest = devDepRequestNode.value;
      throw err;
    }

    return devDepNode.value;
  }

  respondToFSChange({action, path}) {
    // console.log('RESPONDING TO FS CHANGE', action, path);
    // TODO: probably filter elsewhere
    if (action === 'addDir') return;
    let edgeType = getInvalidationEdgeType(action);

    let fileNode = this.nodes.get(path);
    if (fileNode) {
      this.invalidateConnectedNodes(fileNode, edgeType);
    }

    if (action === 'add') {
      for (let globNode of this.getGlobNodesFromGraph()) {
        if (isMatch(path, globNode.value)) {
          this.invalidateConnectedNodes(globNode, edgeType);
        }
      }
    }
  }

  invalidateConnectedNodes(node, edgeType) {
    let nodesToInvalidate = this.getNodesConnectedTo(node, edgeType);
    for (let nodeToInvalidate of nodesToInvalidate) {
      this.invalidateNode(nodeToInvalidate);
    }
  }

  invalidateNode(node: AssetGraphNode) {
    switch (node.type) {
      case TRANSFORMATION_REQUEST:
      case DEPENDENCY_REQUEST:
        this.invalidNodes.set(node.id, node);
        break;
      case CONFIG_REQUEST:
      case DEV_DEP_REQUEST:
        this.invalidNodes.set(node.id, node);
        let actionNode = this.getMainTaskNode(node);
        this.invalidNodes.set(actionNode.id, actionNode);
        break;
      default:
        throw new Error(
          `Cannot invalidate node with unrecognized type ${node.type}`
        );
    }
  }

  getMainTaskNode(node: AssetGraphNode) {
    if (node.type === DEV_DEP_REQUEST) {
      let [configRequestNode] = this.getNodesConnectedTo(node);
      let [actionNode] = this.getNodesConnectedTo(configRequestNode);
      return actionNode;
    } else if (node.type === CONFIG_REQUEST) {
      let [actionNode] = this.getNodesConnectedTo(node);
      return actionNode;
    }
  }

  getGlobNodesFromGraph() {
    return Array.from(this.nodes.values()).filter(node => node.type === 'glob');
  }

  isInvalid() {
    return !!this.invalidNodes.size;
  }

  getDependencies(asset: Asset): Array<IDependency> {
    let node = this.getNode(asset.id);
    if (!node) {
      return [];
    }

    return this.getNodesConnectedFrom(node).map(node => {
      invariant(node.type === DEPENDENCY_REQUEST);
      return node.value;
    });
  }

  getDependencyResolution(dep: IDependency): ?Asset {
    let depNode = this.getNode(dep.id);
    if (!depNode) {
      return null;
    }

    let res: ?Asset = null;
    this.traverse((node, ctx, traversal) => {
      // Prefer real assets when resolving dependencies, but use the first
      // asset reference in absence of a real one.
      if (node.type === 'asset_reference' && !res) {
        res = node.value;
      }

      if (node.type === 'asset') {
        res = node.value;
        traversal.stop();
      }
    }, depNode);

    return res;
  }

  traverseAssets(
    visit: GraphTraversalCallback<Asset, AssetGraphNode>,
    startNode: ?AssetGraphNode
  ): ?AssetGraphNode {
    return this.traverse((node, ...args) => {
      if (node.type === 'asset') {
        return visit(node.value, ...args);
      }
    }, startNode);
  }

  getTotalSize(asset?: ?Asset): number {
    let size = 0;
    let assetNode = asset ? this.getNode(asset.id) : null;
    this.traverseAssets(asset => {
      size += asset.stats.size;
    }, assetNode);

    return size;
  }

  getEntryAssets(): Array<Asset> {
    let entries = [];
    this.traverseAssets((asset, ctx, traversal) => {
      entries.push(asset);
      traversal.skipChildren();
    });

    return entries;
  }

  removeAsset(asset: Asset): ?NodeId {
    let assetNode = this.getNode(asset.id);
    if (!assetNode) {
      return;
    }

    let referenceId = 'asset_reference:' + assetNode.id;
    this.replaceNode(assetNode, {
      type: 'asset_reference',
      id: referenceId,
      value: asset
    });

    return referenceId;
  }
}

class RootNode {
  constructor() {
    this.id = '@@root';
    this.type = 'root';
    this.value = null;
  }
}

const nodeFromDep = (dep: IDependency): DependencyNode => ({
  id: dep.id,
  type: DEPENDENCY_REQUEST,
  value: dep
});

const nodeFromFile = (file: File): FileNode => ({
  id: file.filePath,
  type: 'file',
  value: file
});

const nodeFromGlob = (glob: string) => ({
  id: glob,
  type: 'glob',
  value: glob
});

const nodeFromTransformerRequest = (req: TransformerRequest) => ({
  id: md5FromString(`${req.filePath}:${JSON.stringify(req.env)}`),
  type: TRANSFORMATION_REQUEST,
  value: req
});

const nodeFromAsset = (asset: Asset) => ({
  id: asset.id,
  type: 'asset',
  value: asset
});

const nodeFromConfigRequest = req => ({
  id: md5FromString(`${req.filePath}:${req.plugin}`),
  type: CONFIG_REQUEST,
  value: req
});

const nodeFromConfig = config => ({
  id: md5FromString(
    `${config.resolveFrom}:${config.contentHash || config.content}`
  ),
  type: 'config',
  value: config
});

const nodeFromDevDepRequest = devDepRequest => ({
  id: md5FromString(JSON.stringify(devDepRequest)),
  type: DEV_DEP_REQUEST,
  value: devDepRequest
});

const nodeFromDevDep = devDep => ({
  id: md5FromString(`${devDep.name}:${devDep.version}`),
  type: 'dev_dep',
  value: devDep
});

function getInvalidationEdgeType(eventType) {
  switch (eventType) {
    case 'change':
      return 'invalidated_by_change_to';
    case 'add':
      return 'invalidated_by_addition_matching';
    case 'unlink':
      return 'invalidated_by_removal_of';
    default:
      throw new Error(`Unrecognized invalidation event type "${eventType}"`);
  }
}

export class BuildAbortError extends Error {
  name = 'BuildAbortError';
}
