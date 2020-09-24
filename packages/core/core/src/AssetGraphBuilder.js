// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {FilePath, ModuleSpecifier} from '@parcel/types';
import type WorkerFarm, {Handle, SharedReference} from '@parcel/workers';
import type {Event, Options as WatcherOptions} from '@parcel/watcher';
import type {
  Asset,
  AssetGraphNode,
  AssetGroup,
  AssetRequestInput,
  Dependency,
  Entry,
  ParcelOptions,
  ValidationOpts,
} from './types';
import type {ConfigAndCachePath} from './requests/ParcelConfigRequest';
import type {EntryResult} from './requests/EntryRequest';
import type {TargetResolveResult} from './requests/TargetRequest';

import EventEmitter from 'events';
import nullthrows from 'nullthrows';
import path from 'path';
import {md5FromObject, md5FromString, PromiseQueue} from '@parcel/utils';
import AssetGraph from './AssetGraph';
import RequestTracker, {RequestGraph} from './RequestTracker';
import {PARCEL_VERSION} from './constants';
import ParcelConfig from './ParcelConfig';

import createParcelConfigRequest from './requests/ParcelConfigRequest';
import createEntryRequest from './requests/EntryRequest';
import createTargetRequest from './requests/TargetRequest';
import createAssetRequest from './requests/AssetRequest';
import createPathRequest from './requests/PathRequest';

import Validation from './Validation';
import {report} from './ReporterRunner';

import dumpToGraphViz from './dumpGraphToGraphViz';

type Opts = {|
  options: ParcelOptions,
  optionsRef: SharedReference,
  name: string,
  entries?: Array<string>,
  assetGroups?: Array<AssetGroup>,
  workerFarm: WorkerFarm,
|};

const typesWithRequests = new Set([
  'entry_specifier',
  'entry_file',
  'dependency',
  'asset_group',
]);

export default class AssetGraphBuilder extends EventEmitter {
  assetGraph: AssetGraph;
  requestGraph: RequestGraph;
  requestTracker: RequestTracker;
  assetRequests: Array<AssetGroup>;
  runValidate: ValidationOpts => Promise<void>;
  queue: PromiseQueue<mixed>;

  changedAssets: Map<string, Asset> = new Map();
  options: ParcelOptions;
  optionsRef: SharedReference;
  workerFarm: WorkerFarm;
  cacheKey: string;
  entries: ?Array<string>;
  initialAssetGroups: ?Array<AssetGroup>;

  handle: Handle;

  async init({
    options,
    optionsRef,
    entries,
    name,
    assetGroups,
    workerFarm,
  }: Opts) {
    this.options = options;
    this.optionsRef = optionsRef;
    this.entries = entries;
    this.initialAssetGroups = assetGroups;
    this.workerFarm = workerFarm;
    this.assetRequests = [];

    // TODO: changing these should not throw away the entire graph.
    // We just need to re-run target resolution.
    let {hot, publicUrl, distDir, minify, scopeHoist} = options;
    this.cacheKey = md5FromObject({
      parcelVersion: PARCEL_VERSION,
      name,
      options: {hot, publicUrl, distDir, minify, scopeHoist},
      entries,
    });

    this.queue = new PromiseQueue();

    this.runValidate = workerFarm.createHandle('runValidate');

    let changes = await this.readFromCache();
    if (!changes) {
      this.assetGraph = new AssetGraph();
      this.requestGraph = new RequestGraph();
    }

    this.assetGraph.initOptions({
      onNodeRemoved: node => this.handleNodeRemovedFromAssetGraph(node),
    });

    this.requestTracker = new RequestTracker({
      graph: this.requestGraph,
      farm: workerFarm,
      options: this.options,
    });

    if (changes) {
      this.requestGraph.invalidateUnpredictableNodes();
      this.requestGraph.invalidateEnvNodes(options.env);
      this.requestTracker.respondToFSEvents(changes);
    } else {
      this.assetGraph.initialize({
        entries,
        assetGroups,
      });
    }
  }

  async build(
    signal?: AbortSignal,
  ): Promise<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>,
  |}> {
    this.requestTracker.setSignal(signal);

    let errors = [];

    let root = this.assetGraph.getRootNode();
    if (!root) {
      throw new Error('A root node is required to traverse');
    }

    let visited = new Set([root.id]);

    const visit = node => {
      if (errors.length > 0) {
        return;
      }

      if (this.shouldSkipRequest(node)) {
        visitChildren(node);
      } else {
        this.queueCorrespondingRequest(node).then(
          () => visitChildren(node),
          error => errors.push(error),
        );
      }
    };

    const visitChildren = node => {
      for (let child of this.assetGraph.getNodesConnectedFrom(node)) {
        if (
          (!visited.has(child.id) || child.hasDeferred) &&
          this.assetGraph.shouldVisitChild(node, child)
        ) {
          visited.add(child.id);
          visit(child);
        }
      }
    };

    visit(root);
    await this.queue.run();

    if (errors.length) {
      throw errors[0]; // TODO: eventually support multiple errors since requests could reject in parallel
    }

    dumpToGraphViz(this.assetGraph, 'AssetGraph');
    // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
    dumpToGraphViz(this.requestGraph, 'RequestGraph');

    let changedAssets = this.changedAssets;
    this.changedAssets = new Map();
    return {assetGraph: this.assetGraph, changedAssets: changedAssets};
  }

  // TODO: turn validation into a request
  async validate(): Promise<void> {
    let {config: processedConfig, cachePath} = nullthrows(
      await this.requestTracker.runRequest<null, ConfigAndCachePath>(
        createParcelConfigRequest(),
      ),
    );

    let config = new ParcelConfig(
      processedConfig,
      this.options.packageManager,
      this.options.inputFS,
      this.options.autoinstall,
    );
    let trackedRequestsDesc = this.assetRequests.filter(request => {
      return config.getValidatorNames(request.filePath).length > 0;
    });

    // Schedule validations on workers for all plugins that implement the one-asset-at-a-time "validate" method.
    let promises = trackedRequestsDesc.map(request =>
      this.runValidate({
        requests: [request],
        optionsRef: this.optionsRef,
        configCachePath: cachePath,
      }),
    );

    // Skip sending validation requests if no validators were configured
    if (trackedRequestsDesc.length === 0) {
      return;
    }

    // Schedule validations on the main thread for all validation plugins that implement "validateAll".
    promises.push(
      new Validation({
        requests: trackedRequestsDesc,
        options: this.options,
        config,
        report,
        dedicatedThread: true,
      }).run(),
    );

    this.assetRequests = [];
    await Promise.all(promises);
  }

  shouldSkipRequest(node: AssetGraphNode): boolean {
    return (
      node.complete === true ||
      !typesWithRequests.has(node.type) ||
      (node.correspondingRequest != null &&
        this.requestGraph.getNode(node.correspondingRequest) != null &&
        this.requestTracker.hasValidResult(node.correspondingRequest))
    );
  }

  queueCorrespondingRequest(node: AssetGraphNode): Promise<mixed> {
    switch (node.type) {
      case 'entry_specifier':
        return this.queue.add(() => this.runEntryRequest(node.value));
      case 'entry_file':
        return this.queue.add(() => this.runTargetRequest(node.value));
      case 'dependency':
        return this.queue.add(() => this.runPathRequest(node.value));
      case 'asset_group':
        return this.queue.add(() => this.runAssetRequest(node.value));
      default:
        throw new Error(
          `Can not queue corresponding request of node with type ${node.type}`,
        );
    }
  }

  async runEntryRequest(input: ModuleSpecifier) {
    let request = createEntryRequest(input);
    let result = await this.requestTracker.runRequest<FilePath, EntryResult>(
      request,
    );
    this.assetGraph.resolveEntry(request.input, result.entries, request.id);
  }

  async runTargetRequest(input: Entry) {
    let request = createTargetRequest(input);
    let result = await this.requestTracker.runRequest<
      Entry,
      TargetResolveResult,
    >(request);
    this.assetGraph.resolveTargets(request.input, result.targets, request.id);
  }

  async runPathRequest(input: Dependency) {
    let request = createPathRequest(input);
    let result = await this.requestTracker.runRequest<Dependency, ?AssetGroup>(
      request,
    );
    this.assetGraph.resolveDependency(input, result, request.id);
  }

  async runAssetRequest(input: AssetGroup) {
    this.assetRequests.push(input);
    let request = createAssetRequest({
      ...input,
      optionsRef: this.optionsRef,
    });

    let assets = await this.requestTracker.runRequest<
      AssetRequestInput,
      Array<Asset>,
    >(request);

    if (assets != null) {
      for (let asset of assets) {
        this.changedAssets.set(asset.id, asset);
      }
      this.assetGraph.resolveAssetGroup(input, assets, request.id);
    }
  }

  handleNodeRemovedFromAssetGraph(node: AssetGraphNode) {
    if (node.correspondingRequest != null) {
      this.requestTracker.removeRequest(node.correspondingRequest);
    }
  }

  respondToFSEvents(events: Array<Event>): boolean {
    return this.requestGraph.respondToFSEvents(events);
  }

  getWatcherOptions(): WatcherOptions {
    let vcsDirs = ['.git', '.hg'].map(dir =>
      path.join(this.options.projectRoot, dir),
    );
    let ignore = [this.options.cacheDir, ...vcsDirs];
    return {ignore};
  }

  getCacheKeys(): {|
    assetGraphKey: string,
    requestGraphKey: string,
    snapshotKey: string,
  |} {
    let assetGraphKey = md5FromString(`${this.cacheKey}:assetGraph`);
    let requestGraphKey = md5FromString(`${this.cacheKey}:requestGraph`);
    let snapshotKey = md5FromString(`${this.cacheKey}:snapshot`);
    return {assetGraphKey, requestGraphKey, snapshotKey};
  }

  async readFromCache(): Promise<?Array<Event>> {
    if (this.options.disableCache) {
      return null;
    }

    let {assetGraphKey, requestGraphKey, snapshotKey} = this.getCacheKeys();
    let assetGraph = await this.options.cache.get<AssetGraph>(assetGraphKey);
    let requestGraph = await this.options.cache.get<RequestGraph>(
      requestGraphKey,
    );

    if (assetGraph && requestGraph) {
      this.assetGraph = assetGraph;
      this.requestGraph = requestGraph;

      let opts = this.getWatcherOptions();
      let snapshotPath = this.options.cache._getCachePath(snapshotKey, '.txt');
      return this.options.inputFS.getEventsSince(
        this.options.projectRoot,
        snapshotPath,
        opts,
      );
    }

    return null;
  }

  async writeToCache() {
    if (this.options.disableCache) {
      return;
    }

    let {assetGraphKey, requestGraphKey, snapshotKey} = this.getCacheKeys();
    await this.options.cache.set(assetGraphKey, this.assetGraph);
    await this.options.cache.set(requestGraphKey, this.requestGraph);

    let opts = this.getWatcherOptions();
    let snapshotPath = this.options.cache._getCachePath(snapshotKey, '.txt');
    await this.options.inputFS.writeSnapshot(
      this.options.projectRoot,
      snapshotPath,
      opts,
    );
  }
}
