// @flow strict-local
import EventEmitter from 'events';

import type {AssetRequest, ParcelOptions, Target} from '@parcel/types';
import {PromiseQueue} from '@parcel/utils';
import type {Event} from '@parcel/watcher';

import type Asset from './Asset';
import AssetGraph from './AssetGraph';
import type Config from './Config';
import RequestGraph from './RequestGraph';
import type {
  AssetGraphNode,
  AssetRequestNode,
  CacheEntry,
  DepPathRequestNode
} from './types';

import dumpToGraphViz from './dumpGraphToGraphViz';

type Opts = {|
  options: ParcelOptions,
  config: Config,
  entries?: Array<string>,
  targets?: Array<Target>,
  assetRequest?: AssetRequest
|};

export default class AssetGraphBuilder extends EventEmitter {
  assetGraph: AssetGraph;
  requestGraph: RequestGraph;
  queue: PromiseQueue;
  controller: AbortController;
  changedAssets: Map<string, Asset>;

  constructor({config, options, entries, targets, assetRequest}: Opts) {
    super();

    this.changedAssets = new Map();

    this.assetGraph = new AssetGraph({
      onNodeAdded: node => this.handleNodeAddedToAssetGraph(node),
      onNodeRemoved: node => this.handleNodeRemovedFromAssetGraph(node)
    });
    this.requestGraph = new RequestGraph({
      config,
      options,
      onAssetRequestComplete: this.handleCompletedAssetRequest.bind(this),
      onDepPathRequestComplete: this.handleCompletedDepPathRequest.bind(this)
    });

    this.assetGraph.initialize({
      entries,
      targets,
      assetGroup: assetRequest
    });
  }

  async build(): Promise<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>
  |}> {
    this.changedAssets = new Map();

    await this.requestGraph.completeRequests();

    dumpToGraphViz(this.assetGraph, 'AssetGraph');
    dumpToGraphViz(this.requestGraph, 'RequestGraph');

    return {assetGraph: this.assetGraph, changedAssets: this.changedAssets};
  }

  handleNodeAddedToAssetGraph(node: AssetGraphNode) {
    switch (node.type) {
      case 'dependency':
        this.requestGraph.addDepPathRequest(node.value);
        break;
      case 'asset_group':
        this.requestGraph.addAssetRequest(node.value);
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
        this.requestGraph.removeById(node.id);
        break;
      case 'asset_group':
        this.requestGraph.removeById(node.id);
        break;
    }
  }

  handleCompletedAssetRequest(
    requestNode: AssetRequestNode,
    result: CacheEntry
  ) {
    this.assetGraph.resolveAssetGroup(requestNode.value, result);
  }

  handleCompletedDepPathRequest(
    requestNode: DepPathRequestNode,
    result: AssetRequest | null
  ) {
    this.assetGraph.resolveDependency(requestNode.value, result);
  }

  isInvalid() {
    return this.requestGraph.isInvalid();
  }

  respondToFSEvents(events: Array<Event>) {
    this.requestGraph.respondToFSEvents(events);
  }

  initFarm() {
    return this.requestGraph.initFarm();
  }
}

export class BuildAbortError extends Error {
  name = 'BuildAbortError';
}
