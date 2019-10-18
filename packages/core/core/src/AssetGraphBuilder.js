// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type WorkerFarm, {Handle} from '@parcel/workers';
import type {Event} from '@parcel/watcher';
import type {
  Asset,
  AssetGraphNode,
  AssetRequestDesc,
  AssetRequestNode,
  DepPathRequestNode,
  ParcelOptions,
  Target,
  Dependency
} from './types';
import type ParcelConfig from './ParcelConfig';

import EventEmitter from 'events';
import nullthrows from 'nullthrows';
import path from 'path';
import {md5FromObject, md5FromString} from '@parcel/utils';
import AssetGraph from './AssetGraph';
import RequestTracker, {RequestGraph} from './RequestTracker';
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

const ASSET_GRAPH_REQUEST_MAPPING = new Map([
  ['entry_specifier', 'entry_request'],
  ['entry_file', 'target_request'],
  ['asset_group', 'asset_request'],
  ['dependency', 'dep_path_request']
]);

export default class AssetGraphBuilder extends EventEmitter {
  assetGraph: AssetGraph;
  requestGraph: RequestGraph;
  requestTracker: RequestTracker;

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

    let {minify, hot, scopeHoist} = options;
    this.cacheKey = md5FromObject({
      parcelVersion: PARCEL_VERSION,
      name,
      options: {minify, hot, scopeHoist},
      entries
    });

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
    let runnerMap = new Map([
      ['entry_request', new EntryRequestRunner({options, assetGraph})],
      ['target_request', new TargetRequestRunner({options, assetGraph})],
      [
        'asset_request',
        new AssetRequestRunner({options, workerFarm, assetGraph})
      ],
      [
        'dep_path_request',
        new DepPathRequestRunner({options, config, assetGraph})
      ]
      // ['config_request', new ConfigRequestRunner({options})],
      // ['dep_version_request', new DepVersionRequestRunner({options})]
    ]);
    this.requestTracker = new RequestTracker({
      runnerMap,
      requestGraph: this.requestGraph
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
    let requestPriority = [
      'entry_request',
      'target_request',
      'dep_path_request',
      'asset_request'
    ];

    while (
      this.requestTracker.hasInvalidRequests() &&
      requestPriority.length > 0
    ) {
      let currPriority = requestPriority.shift();
      let promises = [];
      for (let node of this.requestTracker.getInvalidNodes()) {
        if (node.value.type === currPriority) {
          promises.push(
            this.requestTracker.runRequest(node.value.type, node.value.request)
          );
        }
      }
      await Promise.all(promises);
    }

    while (this.assetGraph.hasIncompleteNodes()) {
      let promises = [];
      for (let id of this.assetGraph.incompleteNodeIds) {
        let node = nullthrows(this.assetGraph.getNode(id));
        promises.push(this.processIncompleteAssetGraphNode(node, signal));
      }

      await Promise.all(promises);
    }

    dumpToGraphViz(this.assetGraph, 'AssetGraph');
    dumpToGraphViz(this.requestGraph, 'RequestGraph');

    let changedAssets = this.changedAssets;
    this.changedAssets = new Map();

    return {assetGraph: this.assetGraph, changedAssets: changedAssets};
  }

  validate(): Promise<void> {
    // TODO: console.log('TODO: reimplement AssetGraphBuilder.validate()');
    // for (let asset of this.changedAssets) {
    //   this.runValidate({asset, config});
    // }
  }

  async processIncompleteAssetGraphNode(
    node: AssetGraphNode,
    signal: ?AbortSignal
  ) {
    let requestType = ASSET_GRAPH_REQUEST_MAPPING.get(node.type);
    nullthrows(
      requestType,
      `AssetGraphNode of type ${node.type} should not be marked incomplete`
    );

    let result = await this.requestTracker.runRequest(requestType, node.value, {
      signal
    });

    if (requestType === 'asset_request') {
      for (let asset of result.assets) {
        this.changedAssets.set(asset.id, asset); // ? Is this right?
      }
    }
  }

  handleNodeRemovedFromAssetGraph(node: AssetGraphNode) {
    let requestType = ASSET_GRAPH_REQUEST_MAPPING.get(node.type);
    if (requestType != null) {
      this.requestTracker.removeRequest(requestType, node.value);
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
