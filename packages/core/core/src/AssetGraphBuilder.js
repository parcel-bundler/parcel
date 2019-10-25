// @flow strict-local

import type WorkerFarm from '@parcel/workers';
import type {Event} from '@parcel/watcher';
import type {FilePath} from '@parcel/types';
import type {
  Asset,
  AssetGraphNode,
  AssetRequest,
  AssetRequestNode,
  DepPathRequestNode,
  ParcelOptions,
  Target,
  Dependency
} from './types';

import EventEmitter from 'events';
import {md5FromObject, md5FromString} from '@parcel/utils';

import AssetGraph, {nodeFromAssetGroup} from './AssetGraph';
import type ParcelConfig from './ParcelConfig';
import RequestGraph from './RequestGraph';
import {PARCEL_VERSION} from './constants';

import dumpToGraphViz from './dumpGraphToGraphViz';
import path from 'path';
import invariant from 'assert';

type Opts = {|
  options: ParcelOptions,
  config: ParcelConfig,
  name: string,
  entries?: Array<string>,
  targets?: Array<Target>,
  assetRequests?: Array<AssetRequest>,
  workerFarm: WorkerFarm
|};

const invertMap = <K, V>(map: Map<K, V>): Map<V, K> =>
  new Map([...map].map(([key, val]) => [val, key]));

export default class AssetGraphBuilder extends EventEmitter {
  assetGraph: AssetGraph;
  requestGraph: RequestGraph;
  changedAssets: Map<string, Asset> = new Map();
  options: ParcelOptions;
  cacheKey: string;

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

    let changes = await this.readFromCache();
    if (!changes) {
      this.assetGraph = new AssetGraph();
      this.requestGraph = new RequestGraph();
    }

    this.assetGraph.initOptions({
      onNodeAdded: node => this.handleNodeAddedToAssetGraph(node),
      onNodeRemoved: node => this.handleNodeRemovedFromAssetGraph(node)
    });

    this.requestGraph.initOptions({
      config,
      options,
      onEntryRequestComplete: this.handleCompletedEntryRequest.bind(this),
      onTargetRequestComplete: this.handleCompletedTargetRequest.bind(this),
      onAssetRequestComplete: this.handleCompletedAssetRequest.bind(this),
      onDepPathRequestComplete: this.handleCompletedDepPathRequest.bind(this),
      workerFarm
    });

    if (changes) {
      this.requestGraph.invalidateUnpredictableNodes();
      this.respondToFSEvents(changes);
    } else {
      this.assetGraph.initialize({
        entries,
        assetGroups: assetRequests
      });
    }
  }

  async build(): Promise<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>
  |}> {
    await this.requestGraph.completeRequests();

    dumpToGraphViz(this.assetGraph, 'AssetGraph');
    dumpToGraphViz(this.requestGraph, 'RequestGraph');

    let changedAssets = this.changedAssets;
    this.changedAssets = new Map();

    return {assetGraph: this.assetGraph, changedAssets: changedAssets};
  }

  validate(): Promise<void> {
    return this.requestGraph.completeValidations();
  }

  handleNodeAddedToAssetGraph(node: AssetGraphNode) {
    switch (node.type) {
      case 'entry_specifier':
        this.requestGraph.addEntryRequest(node.value);
        break;
      case 'entry_file':
        this.requestGraph.addTargetRequest(node.value);
        break;
      case 'dependency':
        this.requestGraph.addDepPathRequest(node.value);
        break;
      case 'asset_group':
        if (!node.deferred) {
          this.requestGraph.addAssetRequest(node.id, node.value);
        }
        break;
      case 'asset': {
        let asset = node.value;
        this.changedAssets.set(asset.id, asset); // ? Is this right?
        break;
      }
    }
  }

  handleNodeRemovedFromAssetGraph(node: AssetGraphNode) {
    switch (node.type) {
      case 'dependency':
      case 'asset_group':
        this.requestGraph.removeById(node.id);
        break;
      case 'entry_specifier':
        this.requestGraph.removeById('entry_request:' + node.value);
        break;
      case 'entry_file':
        this.requestGraph.removeById('target_request:' + node.value);
        break;
    }
  }

  handleCompletedEntryRequest(entry: string, resolved: Array<FilePath>) {
    this.assetGraph.resolveEntry(entry, resolved);
  }

  handleCompletedTargetRequest(entryFile: FilePath, targets: Array<Target>) {
    this.assetGraph.resolveTargets(entryFile, targets);
  }

  handleCompletedAssetRequest(
    requestNode: AssetRequestNode,
    assets: Array<Asset>
  ) {
    this.assetGraph.resolveAssetGroup(requestNode.value, assets);
    for (let asset of assets) {
      this.changedAssets.set(asset.id, asset); // ? Is this right?
    }
  }

  // Defer transforming this dependency if it is marked as weak, there are no side effects,
  // no re-exported symbols are used by ancestor dependencies and the re-exporting asset isn't
  // using a wildcard.
  // This helps with performance building large libraries like `lodash-es`, which re-exports
  // a huge number of functions since we can avoid even transforming the files that aren't used.
  shouldDeferDependency(dependency: Dependency, sideEffects: ?boolean) {
    let defer = false;
    if (
      dependency.isWeak &&
      sideEffects === false &&
      !dependency.symbols.has('*')
    ) {
      let depNode = this.assetGraph.getNode(dependency.id);
      invariant(depNode);

      let assets = this.assetGraph.getNodesConnectedTo(depNode);
      let symbols = invertMap(dependency.symbols);
      invariant(assets.length === 1);
      let firstAsset = assets[0];
      invariant(firstAsset.type === 'asset');
      let resolvedAsset = firstAsset.value;
      let deps = this.assetGraph.getIncomingDependencies(resolvedAsset);
      defer = deps.every(
        d =>
          !d.symbols.has('*') &&
          ![...d.symbols.keys()].some(symbol => {
            let assetSymbol = resolvedAsset.symbols.get(symbol);
            return assetSymbol != null && symbols.has(assetSymbol);
          })
      );
    }
    return defer;
  }

  handleCompletedDepPathRequest(
    requestNode: DepPathRequestNode,
    assetGroup: AssetRequest | null
  ) {
    if (!assetGroup) {
      return;
    }
    let dependency = requestNode.value;

    let defer = this.shouldDeferDependency(dependency, assetGroup.sideEffects);

    let assetGroupNode = nodeFromAssetGroup(assetGroup, defer);
    let existingAssetGroupNode = this.assetGraph.getNode(assetGroupNode.id);
    if (existingAssetGroupNode) {
      // Don't overwrite non-deferred asset groups with deferred ones
      invariant(existingAssetGroupNode.type === 'asset_group');
      assetGroupNode.deferred = existingAssetGroupNode.deferred && defer;
    }
    this.assetGraph.resolveDependency(dependency, assetGroupNode);
    if (existingAssetGroupNode) {
      // Node already existed, that asset might have deferred dependencies,
      // recheck all dependencies of all assets of this asset group
      let assetNodes = this.assetGraph
        .getNodesConnectedFrom(assetGroupNode)
        .map(v => {
          invariant(v.type === 'asset');
          return v;
        });
      for (let assetNode of assetNodes) {
        let dependencyNodes = this.assetGraph
          .getNodesConnectedFrom(assetNode)
          .map(v => {
            invariant(v.type === 'dependency');
            return v;
          });
        for (let depNode of dependencyNodes) {
          let assetGroupNodes = this.assetGraph
            .getNodesConnectedFrom(depNode)
            .map(v => {
              invariant(v.type === 'asset_group');
              return v;
            });
          if (assetGroupNodes.length == 0) {
            // Dependency might not be resolved yet
            continue;
          }
          invariant(assetGroupNodes.length === 1);
          let assetGroupNode = assetGroupNodes[0];

          if (
            assetGroupNode.deferred &&
            !this.shouldDeferDependency(
              depNode.value,
              assetGroupNode.value.sideEffects
            )
          ) {
            assetGroupNode.deferred = false;
            this.requestGraph.addAssetRequest(
              assetGroupNode.id,
              assetGroupNode.value
            );
          }
        }
      }
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
