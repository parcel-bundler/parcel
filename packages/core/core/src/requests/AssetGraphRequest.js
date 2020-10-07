// @flow strict-local

import type {Async, FilePath, ModuleSpecifier} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {
  Asset,
  AssetGraphNode,
  AssetGroup,
  AssetRequestInput,
  Dependency,
  Entry,
} from '../types';
import type {StaticRunOpts, RunAPI} from '../RequestTracker';
import type {EntryResult} from './EntryRequest';
import type {TargetResolveResult} from './TargetRequest';

import {PromiseQueue} from '@parcel/utils';
import AssetGraph from '../AssetGraph';
import createEntryRequest from './EntryRequest';
import createTargetRequest from './TargetRequest';
import createAssetRequest from './AssetRequest';
import createPathRequest from './PathRequest';

import dumpToGraphViz from '../dumpGraphToGraphViz';

type AssetGraphRequestInput = {|
  entries?: Array<string>,
  assetGroups?: Array<AssetGroup>,
  optionsRef: SharedReference,
  name: string,
|};

type RunInput = {|
  input: AssetGraphRequestInput,
  ...StaticRunOpts,
|};

type AssetGraphRequest = {|
  id: string,
  +type: 'asset_graph_request',
  run: RunInput => Async<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>,
  |}>,
  input: AssetGraphRequestInput,
|};

export default function createAssetGraphRequest(
  input: AssetGraphRequestInput,
): AssetGraphRequest {
  return {
    type: 'asset_graph_request',
    id: input.name,
    run: async input => {
      let builder = new AssetGraphBuilder(input);
      let {assetGraph, changedAssets} = await builder.build();
      input.api.storeResult({assetGraph, changedAssets: []});
      return {assetGraph, changedAssets};
    },
    input,
  };
}

const typesWithRequests = new Set([
  'entry_specifier',
  'entry_file',
  'dependency',
  'asset_group',
]);

export class AssetGraphBuilder {
  assetGraph: AssetGraph;
  assetRequests: Array<AssetGroup>;
  queue: PromiseQueue<mixed>;
  changedAssets: Map<string, Asset> = new Map();
  optionsRef: SharedReference;
  api: RunAPI;

  constructor({input, prevResult, api}: RunInput) {
    let {entries, assetGroups, optionsRef} = input;
    let assetGraph = prevResult?.assetGraph;
    if (!assetGraph) {
      assetGraph = new AssetGraph();
      assetGraph.initialize({
        entries,
        assetGroups,
      });
    }
    this.assetGraph = assetGraph;
    this.optionsRef = optionsRef;
    this.api = api;
    this.assetRequests = [];

    this.queue = new PromiseQueue();

    // this.assetGraph.initOptions({
    //   onNodeRemoved: node => this.handleNodeRemovedFromAssetGraph(node),
    // });
  }

  async build(): Promise<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>,
  |}> {
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

    let changedAssets = this.changedAssets;
    this.changedAssets = new Map();
    return {assetGraph: this.assetGraph, changedAssets: changedAssets};
  }

  shouldSkipRequest(node: AssetGraphNode): boolean {
    return (
      node.complete === true ||
      !typesWithRequests.has(node.type) ||
      (node.correspondingRequest != null && false) // TODO: figure out best way to skip
      //this.api.hasValidResult(node.correspondingRequest))
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
    let result = await this.api.runRequest<FilePath, EntryResult>(request);
    this.assetGraph.resolveEntry(request.input, result.entries, request.id);
  }

  async runTargetRequest(input: Entry) {
    let request = createTargetRequest(input);
    let result = await this.api.runRequest<Entry, TargetResolveResult>(request);
    this.assetGraph.resolveTargets(request.input, result.targets, request.id);
  }

  async runPathRequest(input: Dependency) {
    let request = createPathRequest(input);
    let result = await this.api.runRequest<Dependency, ?AssetGroup>(request);
    this.assetGraph.resolveDependency(input, result, request.id);
  }

  async runAssetRequest(input: AssetGroup) {
    this.assetRequests.push(input);
    let request = createAssetRequest({
      ...input,
      optionsRef: this.optionsRef,
    });
    let assets = await this.api.runRequest<AssetRequestInput, Array<Asset>>(
      request,
    );

    if (assets != null) {
      for (let asset of assets) {
        this.changedAssets.set(asset.id, asset);
      }
      this.assetGraph.resolveAssetGroup(input, assets, request.id);
    }
  }

  // handleNodeRemovedFromAssetGraph(node: AssetGraphNode) {
  //   // if (node.correspondingRequest != null) {
  //   //   this.api.removeRequest(node.correspondingRequest);
  //   // }
  // }
}
