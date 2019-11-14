// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type WorkerFarm, {Handle} from '@parcel/workers';
import type {Event} from '@parcel/watcher';
import type {
  Asset,
  AssetGraphNode,
  AssetRequestDesc,
  ParcelOptions,
  ValidationOpts
} from './types';
import type ParcelConfig from './ParcelConfig';
import type {RunRequestOpts} from './RequestTracker';
import type {AssetGraphBuildRequest} from './requests';

import EventEmitter from 'events';
import nullthrows from 'nullthrows';
import path from 'path';
import {md5FromObject, md5FromString} from '@parcel/utils';
import AssetGraph from './AssetGraph';
import RequestTracker, {
  RequestGraph,
  generateRequestId
} from './RequestTracker';
import {PARCEL_VERSION} from './constants';
import {
  EntryRequestRunner,
  TargetRequestRunner,
  AssetRequestRunner,
  DepPathRequestRunner
} from './requests';

import dumpToGraphViz from './dumpGraphToGraphViz';

type Opts = {|
  options: ParcelOptions,
  config: ParcelConfig,
  name: string,
  entries?: Array<string>,
  assetRequests?: Array<AssetRequestDesc>,
  workerFarm: WorkerFarm
|};

const requestPriority: $ReadOnlyArray<string> = [
  'entry_request',
  'target_request',
  'dep_path_request',
  'asset_request'
];

export default class AssetGraphBuilder extends EventEmitter {
  assetGraph: AssetGraph;
  requestGraph: RequestGraph;
  requestTracker: RequestTracker;
  entryRequestRunner: EntryRequestRunner;
  targetRequestRunner: TargetRequestRunner;
  depPathRequestRunner: DepPathRequestRunner;
  assetRequestRunner: AssetRequestRunner;
  assetRequests: Array<AssetRequestDesc>;
  runValidate: ValidationOpts => Promise<void>;

  changedAssets: Map<string, Asset> = new Map();
  options: ParcelOptions;
  config: ParcelConfig;
  workerFarm: WorkerFarm;
  cacheKey: string;

  handle: Handle;

  async init({
    config,
    options,
    entries,
    name,
    assetRequests,
    workerFarm
  }: Opts) {
    this.options = options;
    this.assetRequests = [];

    let {minify, hot, scopeHoist} = options;
    this.cacheKey = md5FromObject({
      parcelVersion: PARCEL_VERSION,
      name,
      options: {minify, hot, scopeHoist},
      entries
    });

    this.runValidate = workerFarm.createHandle('runValidate');
    this.handle = workerFarm.createReverseHandle(() => {
      // Do nothing, this is here because there is a bug in `@parcel/workers`
    });

    let changes = await this.readFromCache();
    if (!changes) {
      this.assetGraph = new AssetGraph();
      this.requestGraph = new RequestGraph();
    }

    this.assetGraph.initOptions({
      onNodeRemoved: node => this.handleNodeRemovedFromAssetGraph(node)
    });

    let assetGraph = this.assetGraph;
    this.requestTracker = new RequestTracker({
      graph: this.requestGraph
    });
    let tracker = this.requestTracker;
    this.entryRequestRunner = new EntryRequestRunner({
      tracker,
      options,
      assetGraph
    });
    this.targetRequestRunner = new TargetRequestRunner({
      tracker,
      options,
      assetGraph
    });
    this.assetRequestRunner = new AssetRequestRunner({
      tracker,
      options,
      workerFarm,
      assetGraph
    });
    this.depPathRequestRunner = new DepPathRequestRunner({
      tracker,
      options,
      config,
      assetGraph
    });

    if (changes) {
      this.requestGraph.invalidateUnpredictableNodes();
      this.requestTracker.respondToFSEvents(changes);
    } else {
      this.assetGraph.initialize({
        entries,
        assetGroups: assetRequests
      });
    }
  }

  async build(
    signal?: AbortSignal
  ): Promise<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>
  |}> {
    // TODO: optimize prioritized running of invalid nodes
    let i = 0;

    while (
      this.requestTracker.hasInvalidRequests() &&
      i < requestPriority.length
    ) {
      let currPriority = requestPriority[i++];
      let promises = [];
      for (let request of this.requestTracker.getInvalidRequests()) {
        // $FlowFixMe
        let assetGraphBuildRequest: AssetGraphBuildRequest = (request: any);
        if (request.type === currPriority) {
          promises.push(this.runRequest(assetGraphBuildRequest, {signal}));
        }
      }
      await Promise.all(promises);
    }

    while (this.assetGraph.hasIncompleteNodes()) {
      let promises = [];
      for (let id of this.assetGraph.incompleteNodeIds) {
        promises.push(
          this.processIncompleteAssetGraphNode(
            nullthrows(this.assetGraph.getNode(id)),
            signal
          )
        );
      }

      await Promise.all(promises);
    }

    dumpToGraphViz(this.assetGraph, 'AssetGraph');
    dumpToGraphViz(this.requestGraph, 'RequestGraph');

    let changedAssets = this.changedAssets;
    this.changedAssets = new Map();

    return {assetGraph: this.assetGraph, changedAssets: changedAssets};
  }

  async validate(): Promise<void> {
    let promises = this.assetRequests.map(request =>
      this.runValidate({request, options: this.options})
    );
    this.assetRequests = [];
    await Promise.all(promises);
  }

  async runRequest(request: AssetGraphBuildRequest, runOpts: RunRequestOpts) {
    switch (request.type) {
      case 'entry_request':
        return this.entryRequestRunner.runRequest(request.request, runOpts);
      case 'target_request':
        return this.targetRequestRunner.runRequest(request.request, runOpts);
      case 'dep_path_request':
        return this.depPathRequestRunner.runRequest(request.request, runOpts);
      case 'asset_request': {
        this.assetRequests.push(request.request);
        let result = await this.assetRequestRunner.runRequest(
          request.request,
          runOpts
        );
        if (result != null) {
          for (let asset of result.assets) {
            this.changedAssets.set(asset.id, asset); // ? Is this right?
          }
        }
        return result;
      }
    }
  }

  getCorrespondingRequest(node: AssetGraphNode) {
    switch (node.type) {
      case 'entry_specifier': {
        let type = 'entry_request';
        return {
          type,
          request: node.value,
          id: generateRequestId(type, node.value)
        };
      }
      case 'entry_file': {
        let type = 'target_request';
        return {
          type,
          request: node.value,
          id: generateRequestId(type, node.value)
        };
      }
      case 'dependency': {
        let type = 'dep_path_request';
        return {
          type,
          request: node.value,
          id: generateRequestId(type, node.value)
        };
      }
      case 'asset_group': {
        let type = 'asset_request';
        return {
          type,
          request: node.value,
          id: generateRequestId(type, node.value)
        };
      }
    }
  }

  processIncompleteAssetGraphNode(node: AssetGraphNode, signal: ?AbortSignal) {
    let request = nullthrows(this.getCorrespondingRequest(node));
    return this.runRequest(request, {
      signal
    });
  }

  handleNodeRemovedFromAssetGraph(node: AssetGraphNode) {
    let request = this.getCorrespondingRequest(node);
    if (request != null) {
      this.requestTracker.untrackRequest(request.id);
    }
  }

  respondToFSEvents(events: Array<Event>) {
    return this.requestGraph.respondToFSEvents(events);
  }

  getWatcherOptions() {
    let vcsDirs = ['.git', '.hg'].map(dir =>
      path.join(this.options.projectRoot, dir)
    );
    let ignore = [this.options.cacheDir, ...vcsDirs];
    return {ignore};
  }

  getCacheKeys() {
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
    let assetGraph = await this.options.cache.get(assetGraphKey);
    let requestGraph = await this.options.cache.get(requestGraphKey);

    if (assetGraph && requestGraph) {
      this.assetGraph = assetGraph;
      this.requestGraph = requestGraph;

      let opts = this.getWatcherOptions();
      let snapshotPath = this.options.cache._getCachePath(snapshotKey, '.txt');
      return this.options.inputFS.getEventsSince(
        this.options.projectRoot,
        snapshotPath,
        opts
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
      opts
    );
  }
}
