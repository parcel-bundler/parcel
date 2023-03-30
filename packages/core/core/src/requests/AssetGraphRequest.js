// @flow strict-local

import type {NodeId} from '@parcel/graph';
import type {Async} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {
  Asset,
  AssetGroup,
  AssetRequestInput,
  Dependency,
  Entry,
  ParcelOptions,
  Target,
} from '../types';
import type {StaticRunOpts, RunAPI} from '../RequestTracker';
import type {EntryResult} from './EntryRequest';
import type {PathRequestInput} from './PathRequest';
import type {Diagnostic} from '@parcel/diagnostic';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {PromiseQueue, setEqual} from '@parcel/utils';
import {hashString} from '@parcel/hash';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {Priority} from '../types';
import AssetGraph from '../AssetGraph';
import {PARCEL_VERSION} from '../constants';
import createEntryRequest from './EntryRequest';
import createTargetRequest from './TargetRequest';
import createAssetRequest from './AssetRequest';
import createPathRequest from './PathRequest';
import {type ProjectPath} from '../projectPath';
import dumpGraphToGraphViz from '../dumpGraphToGraphViz';
import {propagateSymbols} from '../SymbolPropagation';

type AssetGraphRequestInput = {|
  entries?: Array<ProjectPath>,
  assetGroups?: Array<AssetGroup>,
  optionsRef: SharedReference,
  name: string,
  shouldBuildLazily?: boolean,
  requestedAssetIds?: Set<string>,
|};

type AssetGraphRequestResult = {|
  assetGraph: AssetGraph,
  /** Assets added/modified since the last successful build. */
  changedAssets: Map<string, Asset>,
  /** Assets added/modified since the last symbol propagation invocation. */
  changedAssetsPropagation: Set<string>,
  assetGroupsWithRemovedParents: ?Set<NodeId>,
  previousSymbolPropagationErrors: ?Map<NodeId, Array<Diagnostic>>,
  assetRequests: Array<AssetGroup>,
|};

type RunInput = {|
  input: AssetGraphRequestInput,
  ...StaticRunOpts<AssetGraphRequestResult>,
|};

type AssetGraphRequest = {|
  id: string,
  +type: 'asset_graph_request',
  run: RunInput => Async<AssetGraphRequestResult>,
  input: AssetGraphRequestInput,
|};

export default function createAssetGraphRequest(
  input: AssetGraphRequestInput,
): AssetGraphRequest {
  return {
    type: 'asset_graph_request',
    id: input.name,
    run: async input => {
      let prevResult =
        await input.api.getPreviousResult<AssetGraphRequestResult>();

      let builder = new AssetGraphBuilder(input, prevResult);
      let assetGraphRequest = await await builder.build();

      // early break for incremental bundling if production or flag is off;
      if (
        !input.options.shouldBundleIncrementally ||
        input.options.mode === 'production'
      ) {
        assetGraphRequest.assetGraph.safeToIncrementallyBundle = false;
      }

      return assetGraphRequest;
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
  assetRequests: Array<AssetGroup> = [];
  queue: PromiseQueue<mixed>;
  changedAssets: Map<string, Asset>;
  changedAssetsPropagation: Set<string>;
  optionsRef: SharedReference;
  options: ParcelOptions;
  api: RunAPI<AssetGraphRequestResult>;
  name: string;
  cacheKey: string;
  shouldBuildLazily: boolean;
  requestedAssetIds: Set<string>;
  isSingleChangeRebuild: boolean;
  assetGroupsWithRemovedParents: Set<NodeId>;
  previousSymbolPropagationErrors: Map<NodeId, Array<Diagnostic>>;

  constructor(
    {input, api, options}: RunInput,
    prevResult: ?AssetGraphRequestResult,
  ) {
    let {
      entries,
      assetGroups,
      optionsRef,
      name,
      requestedAssetIds,
      shouldBuildLazily,
    } = input;
    let assetGraph = prevResult?.assetGraph ?? new AssetGraph();
    assetGraph.safeToIncrementallyBundle = true;
    assetGraph.setRootConnections({
      entries,
      assetGroups,
    });
    this.assetGroupsWithRemovedParents =
      prevResult?.assetGroupsWithRemovedParents ?? new Set();
    this.previousSymbolPropagationErrors =
      prevResult?.previousSymbolPropagationErrors ?? new Map();
    this.changedAssets = prevResult?.changedAssets ?? new Map();
    this.changedAssetsPropagation =
      prevResult?.changedAssetsPropagation ?? new Set();
    this.assetGraph = assetGraph;
    this.optionsRef = optionsRef;
    this.options = options;
    this.api = api;
    this.name = name;
    this.requestedAssetIds = requestedAssetIds ?? new Set();
    this.shouldBuildLazily = shouldBuildLazily ?? false;
    this.cacheKey = hashString(
      `${PARCEL_VERSION}${name}${JSON.stringify(entries) ?? ''}${options.mode}`,
    );

    this.isSingleChangeRebuild =
      api.getInvalidSubRequests().filter(req => req.type === 'asset_request')
        .length === 1;
    this.queue = new PromiseQueue();

    assetGraph.onNodeRemoved = nodeId => {
      this.assetGroupsWithRemovedParents.delete(nodeId);

      // This needs to mark all connected nodes that doesn't become orphaned
      // due to replaceNodesConnectedTo to make sure that the symbols of
      // nodes from which at least one parent was removed are updated.
      let node = nullthrows(assetGraph.getNode(nodeId));
      if (assetGraph.isOrphanedNode(nodeId) && node.type === 'dependency') {
        let children = assetGraph.getNodeIdsConnectedFrom(nodeId);
        for (let child of children) {
          let childNode = nullthrows(assetGraph.getNode(child));
          invariant(
            childNode.type === 'asset_group' || childNode.type === 'asset',
          );
          childNode.usedSymbolsDownDirty = true;
          this.assetGroupsWithRemovedParents.add(child);
        }
      }
    };
  }

  async build(): Promise<AssetGraphRequestResult> {
    let errors = [];
    let rootNodeId = nullthrows(
      this.assetGraph.rootNodeId,
      'A root node is required to traverse',
    );

    let visited = new Set([rootNodeId]);
    const visit = (nodeId: NodeId) => {
      if (errors.length > 0) {
        return;
      }

      if (this.shouldSkipRequest(nodeId)) {
        visitChildren(nodeId);
      } else {
        // ? do we need to visit children inside of the promise that is queued?
        this.queueCorrespondingRequest(nodeId, errors).then(() =>
          visitChildren(nodeId),
        );
      }
    };

    const visitChildren = (nodeId: NodeId) => {
      for (let childNodeId of this.assetGraph.getNodeIdsConnectedFrom(nodeId)) {
        let child = nullthrows(this.assetGraph.getNode(childNodeId));
        if (
          (!visited.has(childNodeId) || child.hasDeferred) &&
          this.shouldVisitChild(nodeId, childNodeId)
        ) {
          visited.add(childNodeId);
          visit(childNodeId);
        }
      }
    };

    visit(rootNodeId);
    await this.queue.run();

    if (errors.length) {
      this.api.storeResult(
        {
          assetGraph: this.assetGraph,
          changedAssets: this.changedAssets,
          changedAssetsPropagation: this.changedAssetsPropagation,
          assetGroupsWithRemovedParents: this.assetGroupsWithRemovedParents,
          previousSymbolPropagationErrors: undefined,
          assetRequests: [],
        },
        this.cacheKey,
      );

      // TODO: eventually support multiple errors since requests could reject in parallel
      throw errors[0];
    }

    if (this.assetGraph.nodes.size > 1) {
      await dumpGraphToGraphViz(
        this.assetGraph,
        'AssetGraph_' + this.name + '_before_prop',
      );
      try {
        let errors = propagateSymbols({
          options: this.options,
          assetGraph: this.assetGraph,
          changedAssetsPropagation: this.changedAssetsPropagation,
          assetGroupsWithRemovedParents: this.assetGroupsWithRemovedParents,
          previousErrors: this.previousSymbolPropagationErrors,
        });
        this.changedAssetsPropagation.clear();

        if (errors.size > 0) {
          this.api.storeResult(
            {
              assetGraph: this.assetGraph,
              changedAssets: this.changedAssets,
              changedAssetsPropagation: this.changedAssetsPropagation,
              assetGroupsWithRemovedParents: this.assetGroupsWithRemovedParents,
              previousSymbolPropagationErrors: errors,
              assetRequests: [],
            },
            this.cacheKey,
          );

          // Just throw the first error. Since errors can bubble (e.g. reexporting a reexported symbol also fails),
          // determining which failing export is the root cause is nontrivial (because of circular dependencies).
          throw new ThrowableDiagnostic({
            diagnostic: [...errors.values()][0],
          });
        }
      } catch (e) {
        await dumpGraphToGraphViz(
          this.assetGraph,
          'AssetGraph_' + this.name + '_failed',
        );
        throw e;
      }
    }
    await dumpGraphToGraphViz(this.assetGraph, 'AssetGraph_' + this.name);

    this.api.storeResult(
      {
        assetGraph: this.assetGraph,
        changedAssets: new Map(),
        changedAssetsPropagation: this.changedAssetsPropagation,
        assetGroupsWithRemovedParents: undefined,
        previousSymbolPropagationErrors: undefined,
        assetRequests: [],
      },
      this.cacheKey,
    );

    return {
      assetGraph: this.assetGraph,
      changedAssets: this.changedAssets,
      changedAssetsPropagation: this.changedAssetsPropagation,
      assetGroupsWithRemovedParents: undefined,
      previousSymbolPropagationErrors: undefined,
      assetRequests: this.assetRequests,
    };
  }

  shouldVisitChild(nodeId: NodeId, childNodeId: NodeId): boolean {
    if (this.shouldBuildLazily) {
      let node = nullthrows(this.assetGraph.getNode(nodeId));
      let childNode = nullthrows(this.assetGraph.getNode(childNodeId));

      if (node.type === 'asset' && childNode.type === 'dependency') {
        if (this.requestedAssetIds.has(node.value.id)) {
          node.requested = true;
        } else if (!node.requested) {
          let isAsyncChild = this.assetGraph
            .getIncomingDependencies(node.value)
            .every(dep => dep.isEntry || dep.priority !== Priority.sync);
          if (isAsyncChild) {
            node.requested = false;
          } else {
            delete node.requested;
          }
        }

        let previouslyDeferred = childNode.deferred;
        childNode.deferred = node.requested === false;

        if (!previouslyDeferred && childNode.deferred) {
          this.assetGraph.markParentsWithHasDeferred(childNodeId);
        } else if (previouslyDeferred && !childNode.deferred) {
          this.assetGraph.unmarkParentsWithHasDeferred(childNodeId);
        }

        return !childNode.deferred;
      }
    }

    return this.assetGraph.shouldVisitChild(nodeId, childNodeId);
  }

  shouldSkipRequest(nodeId: NodeId): boolean {
    let node = nullthrows(this.assetGraph.getNode(nodeId));
    return (
      node.complete === true ||
      !typesWithRequests.has(node.type) ||
      (node.correspondingRequest != null &&
        this.api.canSkipSubrequest(node.correspondingRequest))
    );
  }

  queueCorrespondingRequest(
    nodeId: NodeId,
    errors: Array<Error>,
  ): Promise<mixed> {
    let promise;
    let node = nullthrows(this.assetGraph.getNode(nodeId));
    switch (node.type) {
      case 'entry_specifier':
        promise = this.runEntryRequest(node.value);
        break;
      case 'entry_file':
        promise = this.runTargetRequest(node.value);
        break;
      case 'dependency':
        promise = this.runPathRequest(node.value);
        break;
      case 'asset_group':
        promise = this.runAssetRequest(node.value);
        break;
      default:
        throw new Error(
          `Can not queue corresponding request of node with type ${node.type}`,
        );
    }
    return this.queue.add(() =>
      promise.then(null, error => errors.push(error)),
    );
  }

  async runEntryRequest(input: ProjectPath) {
    let prevEntries = this.assetGraph.safeToIncrementallyBundle
      ? this.assetGraph
          .getEntryAssets()
          .map(asset => asset.id)
          .sort()
      : [];

    let request = createEntryRequest(input);
    let result = await this.api.runRequest<ProjectPath, EntryResult>(request, {
      force: true,
    });
    this.assetGraph.resolveEntry(request.input, result.entries, request.id);

    if (this.assetGraph.safeToIncrementallyBundle) {
      let currentEntries = this.assetGraph
        .getEntryAssets()
        .map(asset => asset.id)
        .sort();
      let didEntriesChange =
        prevEntries.length !== currentEntries.length ||
        prevEntries.every(
          (entryId, index) => entryId === currentEntries[index],
        );

      if (didEntriesChange) {
        this.assetGraph.safeToIncrementallyBundle = false;
      }
    }
  }

  async runTargetRequest(input: Entry) {
    let request = createTargetRequest(input);
    let targets = await this.api.runRequest<Entry, Array<Target>>(request, {
      force: true,
    });
    this.assetGraph.resolveTargets(request.input, targets, request.id);
  }

  async runPathRequest(input: Dependency) {
    let request = createPathRequest({dependency: input, name: this.name});
    let result = await this.api.runRequest<PathRequestInput, ?AssetGroup>(
      request,
      {force: true},
    );
    this.assetGraph.resolveDependency(input, result, request.id);
  }

  async runAssetRequest(input: AssetGroup) {
    this.assetRequests.push(input);
    let request = createAssetRequest({
      ...input,
      name: this.name,
      optionsRef: this.optionsRef,
      isSingleChangeRebuild: this.isSingleChangeRebuild,
    });
    let assets = await this.api.runRequest<AssetRequestInput, Array<Asset>>(
      request,
      {force: true},
    );

    if (assets != null) {
      for (let asset of assets) {
        if (this.assetGraph.safeToIncrementallyBundle) {
          let otherAsset = this.assetGraph.getNodeByContentKey(asset.id);
          if (otherAsset != null) {
            invariant(otherAsset.type === 'asset');
            if (!this._areDependenciesEqualForAssets(asset, otherAsset.value)) {
              this.assetGraph.safeToIncrementallyBundle = false;
            }
          } else {
            // adding a new entry or dependency
            this.assetGraph.safeToIncrementallyBundle = false;
          }
        }
        this.changedAssets.set(asset.id, asset);
        this.changedAssetsPropagation.add(asset.id);
      }
      this.assetGraph.resolveAssetGroup(input, assets, request.id);
    } else {
      this.assetGraph.safeToIncrementallyBundle = false;
    }

    this.isSingleChangeRebuild = false;
  }

  /**
   * Used for incremental bundling of modified assets
   */
  _areDependenciesEqualForAssets(asset: Asset, otherAsset: Asset): boolean {
    let assetDependencies = Array.from(asset?.dependencies.keys()).sort();
    let otherAssetDependencies = Array.from(
      otherAsset?.dependencies.keys(),
    ).sort();

    if (assetDependencies.length !== otherAssetDependencies.length) {
      return false;
    }

    return assetDependencies.every((key, index) => {
      if (key !== otherAssetDependencies[index]) {
        return false;
      }

      return setEqual(
        new Set(asset?.dependencies.get(key)?.symbols?.keys()),
        new Set(otherAsset?.dependencies.get(key)?.symbols?.keys()),
      );
    });
  }
}
