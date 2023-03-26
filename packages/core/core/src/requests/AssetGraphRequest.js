// @flow strict-local

import type {ContentKey, NodeId} from '@parcel/graph';
import type {Async, Meta, Symbol} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {
  Asset,
  AssetGroup,
  AssetNode,
  AssetRequestInput,
  Dependency,
  DependencyNode,
  Entry,
  InternalSourceLocation,
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
import logger from '@parcel/logger';
import ThrowableDiagnostic, {md} from '@parcel/diagnostic';
import {BundleBehavior, Priority} from '../types';
import AssetGraph from '../AssetGraph';
import {PARCEL_VERSION} from '../constants';
import createEntryRequest from './EntryRequest';
import createTargetRequest from './TargetRequest';
import createAssetRequest from './AssetRequest';
import createPathRequest from './PathRequest';
import {
  type ProjectPath,
  fromProjectPathRelative,
  fromProjectPath,
} from '../projectPath';
import dumpGraphToGraphViz from '../dumpGraphToGraphViz';

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
        let errors = this.propagateSymbols({
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

  propagateSymbols({
    options,
    assetGraph,
    changedAssetsPropagation,
    assetGroupsWithRemovedParents,
    previousErrors,
  }: {|
    options: ParcelOptions,
    assetGraph: AssetGraph,
    changedAssetsPropagation: Set<string>,
    assetGroupsWithRemovedParents: Set<NodeId>,
    previousErrors?: ?Map<NodeId, Array<Diagnostic>>,
  |}): Map<NodeId, Array<Diagnostic>> {
    let changedAssets = new Set(
      [...changedAssetsPropagation].map(id =>
        assetGraph.getNodeIdByContentKey(id),
      ),
    );

    // To reorder once at the end
    let changedDeps = new Set<DependencyNode>();

    // For the down traversal, the nodes with `usedSymbolsDownDirty = true` are exactly
    // `changedAssetsPropagation` (= asset and therefore potentially dependencies changed) or the
    // asset children of `assetGroupsWithRemovedParents` (= fewer incoming dependencies causing less
    // used symbols).
    //
    // The up traversal has to consider all nodes that changed in the down traversal
    // (`useSymbolsUpDirtyDown = true`) which are listed in `changedDepsUsedSymbolsUpDirtyDown`
    // (more or less requested symbols) and in `changedAssetsPropagation` (changing an asset might
    // change exports).

    // The dependencies that changed in the down traversal causing an update in the up traversal.
    let changedDepsUsedSymbolsUpDirtyDown = new Set<ContentKey>();

    // Propagate the requested symbols down from the root to the leaves
    this.propagateSymbolsDown(
      assetGraph,
      changedAssets,
      assetGroupsWithRemovedParents,
      (assetNode, incomingDeps, outgoingDeps) => {
        // exportSymbol -> identifier
        let assetSymbols: ?$ReadOnlyMap<
          Symbol,
          {|local: Symbol, loc: ?InternalSourceLocation, meta?: ?Meta|},
        > = assetNode.value.symbols;
        // identifier -> exportSymbol
        let assetSymbolsInverse;
        if (assetSymbols) {
          assetSymbolsInverse = new Map<Symbol, Set<Symbol>>();
          for (let [s, {local}] of assetSymbols) {
            let set = assetSymbolsInverse.get(local);

            if (!set) {
              set = new Set();
              assetSymbolsInverse.set(local, set);
            }
            set.add(s);
          }
        }
        let hasNamespaceOutgoingDeps = outgoingDeps.some(
          d => d.value.symbols?.get('*')?.local === '*',
        );

        // 1) Determine what the incomingDeps requests from the asset
        // ----------------------------------------------------------

        let isEntry = false;
        let addAll = false;

        // Used symbols that are exported or reexported (symbol will be removed again later) by asset.
        assetNode.usedSymbols = new Set();

        // Symbols that have to be namespace reexported by outgoingDeps.
        let namespaceReexportedSymbols = new Set<Symbol>();

        if (incomingDeps.length === 0) {
          // Root in the runtimes Graph
          assetNode.usedSymbols.add('*');
          namespaceReexportedSymbols.add('*');
        } else {
          for (let incomingDep of incomingDeps) {
            if (incomingDep.value.symbols == null) {
              if (incomingDep.value.sourceAssetId == null) {
                // The root dependency on non-library builds
                isEntry = true;
              } else {
                // A regular dependency with cleared symbols
                addAll = true;
              }
              continue;
            }

            for (let exportSymbol of incomingDep.usedSymbolsDown) {
              if (exportSymbol === '*') {
                assetNode.usedSymbols.add('*');
                namespaceReexportedSymbols.add('*');
              }
              if (
                !assetSymbols ||
                assetSymbols.has(exportSymbol) ||
                assetSymbols.has('*')
              ) {
                // An own symbol or a non-namespace reexport
                assetNode.usedSymbols.add(exportSymbol);
              }
              // A namespace reexport
              // (but only if we actually have namespace-exporting outgoing dependencies,
              // This usually happens with a reexporting asset with many namespace exports which means that
              // we cannot match up the correct asset with the used symbol at this level.)
              else if (hasNamespaceOutgoingDeps && exportSymbol !== 'default') {
                namespaceReexportedSymbols.add(exportSymbol);
              }
            }
          }
        }

        // Incomding dependency with cleared symbols, add everything
        if (addAll) {
          assetSymbols?.forEach((_, exportSymbol) =>
            assetNode.usedSymbols.add(exportSymbol),
          );
        }

        // 2) Distribute the symbols to the outgoing dependencies
        // ----------------------------------------------------------
        for (let dep of outgoingDeps) {
          let depUsedSymbolsDownOld = dep.usedSymbolsDown;
          let depUsedSymbolsDown = new Set();
          dep.usedSymbolsDown = depUsedSymbolsDown;
          if (
            assetNode.value.sideEffects ||
            // Incoming dependency with cleared symbols
            addAll ||
            // For entries, we still need to add dep.value.symbols of the entry (which are "used" but not according to the symbols data)
            isEntry ||
            // If not a single symbol is used, we can say the entire subgraph is not used.
            // This is e.g. needed when some symbol is imported and then used for a export which isn't used (= "semi-weak" reexport)
            //    index.js:     `import {bar} from "./lib"; ...`
            //    lib/index.js: `export * from "./foo.js"; export * from "./bar.js";`
            //    lib/foo.js:   `import { data } from "./bar.js"; export const foo = data + " esm2";`
            assetNode.usedSymbols.size > 0 ||
            namespaceReexportedSymbols.size > 0
          ) {
            let depSymbols = dep.value.symbols;
            if (!depSymbols) continue;

            if (depSymbols.get('*')?.local === '*') {
              if (addAll) {
                depUsedSymbolsDown.add('*');
              } else {
                for (let s of namespaceReexportedSymbols) {
                  // We need to propagate the namespaceReexportedSymbols to all namespace dependencies (= even wrong ones because we don't know yet)
                  depUsedSymbolsDown.add(s);
                }
              }
            }

            for (let [symbol, {local}] of depSymbols) {
              // Was already handled above
              if (local === '*') continue;

              if (!assetSymbolsInverse || !depSymbols.get(symbol)?.isWeak) {
                // Bailout or non-weak symbol (= used in the asset itself = not a reexport)
                depUsedSymbolsDown.add(symbol);
              } else {
                let reexportedExportSymbols = assetSymbolsInverse.get(local);
                if (reexportedExportSymbols == null) {
                  // not reexported = used in asset itself
                  depUsedSymbolsDown.add(symbol);
                } else if (assetNode.usedSymbols.has('*')) {
                  // we need everything
                  depUsedSymbolsDown.add(symbol);

                  [...reexportedExportSymbols].forEach(s =>
                    assetNode.usedSymbols.delete(s),
                  );
                } else {
                  let usedReexportedExportSymbols = [
                    ...reexportedExportSymbols,
                  ].filter(s => assetNode.usedSymbols.has(s));
                  if (usedReexportedExportSymbols.length > 0) {
                    // The symbol is indeed a reexport, so it's not used from the asset itself
                    depUsedSymbolsDown.add(symbol);

                    usedReexportedExportSymbols.forEach(s =>
                      assetNode.usedSymbols.delete(s),
                    );
                  }
                }
              }
            }
          } else {
            depUsedSymbolsDown.clear();
          }
          if (!setEqual(depUsedSymbolsDownOld, depUsedSymbolsDown)) {
            dep.usedSymbolsDownDirty = true;
            dep.usedSymbolsUpDirtyDown = true;
            changedDepsUsedSymbolsUpDirtyDown.add(dep.id);
          }
          if (dep.usedSymbolsUpDirtyDown) {
            // Set on node creation
            changedDepsUsedSymbolsUpDirtyDown.add(dep.id);
          }
        }
      },
    );

    const logFallbackNamespaceInsertion = (
      assetNode,
      symbol: Symbol,
      depNode1,
      depNode2,
    ) => {
      if (options.logLevel === 'verbose') {
        logger.warn({
          message: `${fromProjectPathRelative(
            assetNode.value.filePath,
          )} reexports "${symbol}", which could be resolved either to the dependency "${
            depNode1.value.specifier
          }" or "${
            depNode2.value.specifier
          }" at runtime. Adding a namespace object to fall back on.`,
          origin: '@parcel/core',
        });
      }
    };

    // Because namespace reexports introduce ambiguity, go up the graph from the leaves to the
    // root and remove requested symbols that aren't actually exported
    let errors = this.propagateSymbolsUp(
      assetGraph,
      changedAssets,
      changedDepsUsedSymbolsUpDirtyDown,
      previousErrors,
      (assetNode, incomingDeps, outgoingDeps) => {
        let assetSymbols: ?$ReadOnlyMap<
          Symbol,
          {|local: Symbol, loc: ?InternalSourceLocation, meta?: ?Meta|},
        > = assetNode.value.symbols;

        let assetSymbolsInverse = null;
        if (assetSymbols) {
          assetSymbolsInverse = new Map<Symbol, Set<Symbol>>();
          for (let [s, {local}] of assetSymbols) {
            let set = assetSymbolsInverse.get(local);
            if (!set) {
              set = new Set();
              assetSymbolsInverse.set(local, set);
            }
            set.add(s);
          }
        }

        // the symbols that are reexported (not used in `asset`) -> asset they resolved to
        let reexportedSymbols = new Map<
          Symbol,
          ?{|asset: ContentKey, symbol: ?Symbol|},
        >();
        // the symbols that are reexported (not used in `asset`) -> the corresponding outgoingDep(s)
        // To generate the diagnostic when there are multiple dependencies with non-statically
        // analyzable exports
        let reexportedSymbolsSource = new Map<Symbol, DependencyNode>();
        for (let outgoingDep of outgoingDeps) {
          let outgoingDepSymbols = outgoingDep.value.symbols;
          if (!outgoingDepSymbols) continue;

          let isExcluded =
            assetGraph.getNodeIdsConnectedFrom(
              assetGraph.getNodeIdByContentKey(outgoingDep.id),
            ).length === 0;
          // excluded, assume everything that is requested exists
          if (isExcluded) {
            outgoingDep.usedSymbolsDown.forEach((_, s) =>
              outgoingDep.usedSymbolsUp.set(s, null),
            );
          }

          if (outgoingDepSymbols.get('*')?.local === '*') {
            outgoingDep.usedSymbolsUp.forEach((sResolved, s) => {
              if (s === 'default') {
                return;
              }

              // If the symbol could come from multiple assets at runtime, assetNode's
              // namespace will be needed at runtime to perform the lookup on.
              if (reexportedSymbols.has(s)) {
                if (!assetNode.usedSymbols.has('*')) {
                  logFallbackNamespaceInsertion(
                    assetNode,
                    s,
                    nullthrows(reexportedSymbolsSource.get(s)),
                    outgoingDep,
                  );
                }
                assetNode.usedSymbols.add('*');
                reexportedSymbols.set(s, {asset: assetNode.id, symbol: s});
              } else {
                reexportedSymbols.set(s, sResolved);
                reexportedSymbolsSource.set(s, outgoingDep);
              }
            });
          }

          for (let [s, sResolved] of outgoingDep.usedSymbolsUp) {
            if (!outgoingDep.usedSymbolsDown.has(s)) {
              // usedSymbolsDown is a superset of usedSymbolsUp
              continue;
            }

            let local = outgoingDepSymbols.get(s)?.local;

            if (local == null) {
              // Caused by '*' => '*', already handled
              continue;
            }

            let reexported = assetSymbolsInverse?.get(local);
            if (reexported != null) {
              reexported.forEach(s => {
                // see same code above
                if (reexportedSymbols.has(s)) {
                  if (!assetNode.usedSymbols.has('*')) {
                    logFallbackNamespaceInsertion(
                      assetNode,
                      s,
                      nullthrows(reexportedSymbolsSource.get(s)),
                      outgoingDep,
                    );
                  }
                  assetNode.usedSymbols.add('*');
                  reexportedSymbols.set(s, {asset: assetNode.id, symbol: s});
                } else {
                  reexportedSymbols.set(s, sResolved);
                  reexportedSymbolsSource.set(s, outgoingDep);
                }
              });
            }
          }
        }

        let errors: Array<Diagnostic> = [];

        function usedSymbolsUpAmbiguous(old, current, s, value) {
          if (old.has(s)) {
            let valueOld = old.get(s);
            if (
              valueOld !== value &&
              !(
                valueOld?.asset === value.asset &&
                valueOld?.symbol === value.symbol
              )
            ) {
              // The dependency points to multiple assets (via an asset group).
              current.set(s, undefined);
              return;
            }
          }
          current.set(s, value);
        }

        for (let incomingDep of incomingDeps) {
          let incomingDepUsedSymbolsUpOld = incomingDep.usedSymbolsUp;
          incomingDep.usedSymbolsUp = new Map();
          let incomingDepSymbols = incomingDep.value.symbols;
          if (!incomingDepSymbols) continue;

          let hasNamespaceReexport = incomingDepSymbols.get('*')?.local === '*';
          for (let s of incomingDep.usedSymbolsDown) {
            if (
              assetSymbols == null || // Assume everything could be provided if symbols are cleared
              assetNode.value.bundleBehavior === BundleBehavior.isolated ||
              assetNode.value.bundleBehavior === BundleBehavior.inline ||
              s === '*' ||
              assetNode.usedSymbols.has(s)
            ) {
              usedSymbolsUpAmbiguous(
                incomingDepUsedSymbolsUpOld,
                incomingDep.usedSymbolsUp,
                s,
                {
                  asset: assetNode.id,
                  symbol: s,
                },
              );
            } else if (reexportedSymbols.has(s)) {
              let reexport = reexportedSymbols.get(s);
              let v =
                // Forward a reexport only if the current asset is side-effect free and not external
                !assetNode.value.sideEffects && reexport != null
                  ? reexport
                  : {
                      asset: assetNode.id,
                      symbol: s,
                    };
              usedSymbolsUpAmbiguous(
                incomingDepUsedSymbolsUpOld,
                incomingDep.usedSymbolsUp,
                s,
                v,
              );
            } else if (!hasNamespaceReexport) {
              let loc = incomingDep.value.symbols?.get(s)?.loc;
              let [resolutionNodeId] = assetGraph.getNodeIdsConnectedFrom(
                assetGraph.getNodeIdByContentKey(incomingDep.id),
              );
              let resolution = nullthrows(assetGraph.getNode(resolutionNodeId));
              invariant(resolution && resolution.type === 'asset_group');

              errors.push({
                message: md`${fromProjectPathRelative(
                  resolution.value.filePath,
                )} does not export '${s}'`,
                origin: '@parcel/core',
                codeFrames: loc
                  ? [
                      {
                        filePath:
                          fromProjectPath(options.projectRoot, loc?.filePath) ??
                          undefined,
                        language:
                          incomingDep.value.sourceAssetType ?? undefined,
                        codeHighlights: [
                          {
                            start: loc.start,
                            end: loc.end,
                          },
                        ],
                      },
                    ]
                  : undefined,
              });
            }
          }

          if (
            !equalMap(incomingDepUsedSymbolsUpOld, incomingDep.usedSymbolsUp)
          ) {
            changedDeps.add(incomingDep);
            incomingDep.usedSymbolsUpDirtyUp = true;
          }

          incomingDep.excluded = false;
          if (
            incomingDep.value.symbols != null &&
            incomingDep.usedSymbolsUp.size === 0
          ) {
            let assetGroups = assetGraph.getNodeIdsConnectedFrom(
              assetGraph.getNodeIdByContentKey(incomingDep.id),
            );
            if (assetGroups.length === 1) {
              let [assetGroupId] = assetGroups;
              let assetGroup = nullthrows(assetGraph.getNode(assetGroupId));
              if (
                assetGroup.type === 'asset_group' &&
                assetGroup.value.sideEffects === false
              ) {
                incomingDep.excluded = true;
              }
            } else {
              invariant(assetGroups.length === 0);
            }
          }
        }
        return errors;
      },
    );

    // Sort usedSymbolsUp so they are a consistent order across builds.
    // This ensures a consistent ordering of these symbols when packaging.
    // See https://github.com/parcel-bundler/parcel/pull/8212
    for (let dep of changedDeps) {
      dep.usedSymbolsUp = new Map(
        [...dep.usedSymbolsUp].sort(([a], [b]) => a.localeCompare(b)),
      );
    }

    return errors;
  }

  propagateSymbolsDown(
    assetGraph: AssetGraph,
    changedAssets: Set<NodeId>,
    assetGroupsWithRemovedParents: Set<NodeId>,
    visit: (
      assetNode: AssetNode,
      incoming: $ReadOnlyArray<DependencyNode>,
      outgoing: $ReadOnlyArray<DependencyNode>,
    ) => void,
  ) {
    if (changedAssets.size === 0 && assetGroupsWithRemovedParents.size === 0) {
      return;
    }

    // We care about changed assets and their changed dependencies. So start with the first changed
    // asset or dependency and continue while the symbols change. If the queue becomes empty,
    // continue with the next unvisited changed asset.
    //
    // In the end, nodes, which are neither listed in changedAssets nor in
    // assetGroupsWithRemovedParents nor reached via a dirty flag, don't have to be visited at all.
    //
    // In the worst case, some nodes have to be revisited because we don't want to sort the assets
    // into topological order. For example in a diamond graph where the join point is visited twice
    // via each parent (the numbers signifiying the order of re/visiting, `...` being unvisited).
    // However, this only continues as long as there are changes in the used symbols that influence
    // child nodes.
    //
    //             |
    //            ...
    //          /     \
    //          1     4
    //          \     /
    //            2+5
    //             |
    //            3+6
    //             |
    //            ...
    //             |
    //

    let unreachedAssets = new Set([
      ...changedAssets,
      ...assetGroupsWithRemovedParents,
    ]);
    let queue = new Set([setPop(unreachedAssets)]);

    while (queue.size > 0) {
      let queuedNodeId = setPop(queue);
      unreachedAssets.delete(queuedNodeId);

      let outgoing = assetGraph.getNodeIdsConnectedFrom(queuedNodeId);
      let node = nullthrows(assetGraph.getNode(queuedNodeId));

      let wasNodeDirty = false;
      if (node.type === 'dependency' || node.type === 'asset_group') {
        wasNodeDirty = node.usedSymbolsDownDirty;
        node.usedSymbolsDownDirty = false;
      } else if (node.type === 'asset' && node.usedSymbolsDownDirty) {
        visit(
          node,
          assetGraph.getIncomingDependencies(node.value).map(d => {
            let dep = assetGraph.getNodeByContentKey(d.id);
            invariant(dep && dep.type === 'dependency');
            return dep;
          }),
          outgoing.map(dep => {
            let depNode = nullthrows(assetGraph.getNode(dep));
            invariant(depNode.type === 'dependency');
            return depNode;
          }),
        );
        node.usedSymbolsDownDirty = false;
      }

      for (let child of outgoing) {
        let childNode = nullthrows(assetGraph.getNode(child));
        let childDirty = false;
        if (
          (childNode.type === 'asset' || childNode.type === 'asset_group') &&
          wasNodeDirty
        ) {
          childNode.usedSymbolsDownDirty = true;
          childDirty = true;
        } else if (childNode.type === 'dependency') {
          childDirty = childNode.usedSymbolsDownDirty;
        }
        if (childDirty) {
          queue.add(child);
        }
      }

      if (queue.size === 0 && unreachedAssets.size > 0) {
        queue.add(setPop(unreachedAssets));
      }
    }
  }

  propagateSymbolsUp(
    assetGraph: AssetGraph,
    changedAssets: Set<NodeId>,
    changedDepsUsedSymbolsUpDirtyDown: Set<ContentKey>,
    previousErrors: ?Map<NodeId, Array<Diagnostic>>,
    visit: (
      assetNode: AssetNode,
      incoming: $ReadOnlyArray<DependencyNode>,
      outgoing: $ReadOnlyArray<DependencyNode>,
    ) => Array<Diagnostic>,
  ): Map<NodeId, Array<Diagnostic>> {
    // For graphs in general (so with cyclic dependencies), some nodes will have to be revisited. So
    // run a regular queue-based BFS for anything that's still dirty.
    //
    // (Previously, there was first a recursive post-order DFS, with the idea that all children of a
    // node should be processed first. With a tree, this would result in a minimal amount of work by
    // processing every asset exactly once and then the remaining cycles would have been handled
    // with the loop. This was slightly faster for initial builds but had O(project) instead of
    // O(changes).)

    let errors: Map<NodeId, Array<Diagnostic>> = previousErrors
      ? // Some nodes might have been removed since the last build
        new Map([...previousErrors].filter(([n]) => assetGraph.hasNode(n)))
      : new Map();

    let changedDepsUsedSymbolsUpDirtyDownAssets = new Set([
      ...[...changedDepsUsedSymbolsUpDirtyDown]
        .reverse()
        .flatMap(id => getDependencyResolution(assetGraph, id)),
      ...changedAssets,
    ]);

    // Do a more efficient full traversal (less recomputations) if more than half of the assets
    // changed.
    let runFullPass =
      // If there are n nodes in the graph, then the asset count is approximately
      // n/6 (for every asset, there are ~4 dependencies and ~1 asset_group).
      assetGraph.nodes.size * (1 / 6) * 0.5 <
      changedDepsUsedSymbolsUpDirtyDownAssets.size;

    let dirtyDeps;
    if (runFullPass) {
      dirtyDeps = new Set<NodeId>();
      let rootNodeId = nullthrows(
        assetGraph.rootNodeId,
        'A root node is required to traverse',
      );
      let visited = new Set([rootNodeId]);
      const walk = (nodeId: NodeId) => {
        let node = nullthrows(assetGraph.getNode(nodeId));
        let outgoing = assetGraph.getNodeIdsConnectedFrom(nodeId);
        for (let childId of outgoing) {
          if (!visited.has(childId)) {
            visited.add(childId);
            walk(childId);
            let child = nullthrows(assetGraph.getNode(childId));
            if (node.type === 'asset') {
              invariant(child.type === 'dependency');
              if (child.usedSymbolsUpDirtyUp) {
                node.usedSymbolsUpDirty = true;
                child.usedSymbolsUpDirtyUp = false;
              }
            }
          }
        }

        if (node.type === 'asset') {
          let incoming = assetGraph
            .getIncomingDependencies(node.value)
            .map(d => {
              let n = assetGraph.getNodeByContentKey(d.id);
              invariant(n && n.type === 'dependency');
              return n;
            });
          for (let dep of incoming) {
            if (dep.usedSymbolsUpDirtyDown) {
              dep.usedSymbolsUpDirtyDown = false;
              node.usedSymbolsUpDirty = true;
            }
          }
          if (node.usedSymbolsUpDirty) {
            let e = visit(
              node,
              incoming,
              outgoing.map(depNodeId => {
                let depNode = nullthrows(assetGraph.getNode(depNodeId));
                invariant(depNode.type === 'dependency');
                return depNode;
              }),
            );
            if (e.length > 0) {
              node.usedSymbolsUpDirty = true;
              errors.set(nodeId, e);
            } else {
              node.usedSymbolsUpDirty = false;
              errors.delete(nodeId);
            }
          }
        } else {
          if (node.type === 'dependency') {
            if (node.usedSymbolsUpDirtyUp) {
              dirtyDeps.add(nodeId);
            } else {
              dirtyDeps.delete(nodeId);
            }
          }
        }
      };
      walk(rootNodeId);
    }

    let queue = dirtyDeps ?? changedDepsUsedSymbolsUpDirtyDownAssets;
    while (queue.size > 0) {
      let queuedNodeId = setPop(queue);
      let node = nullthrows(assetGraph.getNode(queuedNodeId));
      if (node.type === 'asset') {
        let incoming = assetGraph
          .getIncomingDependencies(node.value)
          .map(dep => {
            let depNode = assetGraph.getNodeByContentKey(dep.id);
            invariant(depNode && depNode.type === 'dependency');
            return depNode;
          });
        for (let dep of incoming) {
          if (dep.usedSymbolsUpDirtyDown) {
            dep.usedSymbolsUpDirtyDown = false;
            node.usedSymbolsUpDirty = true;
          }
        }
        let outgoing = assetGraph
          .getNodeIdsConnectedFrom(queuedNodeId)
          .map(depNodeId => {
            let depNode = nullthrows(assetGraph.getNode(depNodeId));
            invariant(depNode.type === 'dependency');
            return depNode;
          });
        for (let dep of outgoing) {
          if (dep.usedSymbolsUpDirtyUp) {
            node.usedSymbolsUpDirty = true;
            dep.usedSymbolsUpDirtyUp = false;
          }
        }

        if (node.usedSymbolsUpDirty) {
          let e = visit(node, incoming, outgoing);
          if (e.length > 0) {
            node.usedSymbolsUpDirty = true;
            errors.set(queuedNodeId, e);
          } else {
            node.usedSymbolsUpDirty = false;
            errors.delete(queuedNodeId);
          }
        }

        for (let i of incoming) {
          if (i.usedSymbolsUpDirtyUp) {
            queue.add(assetGraph.getNodeIdByContentKey(i.id));
          }
        }
      } else {
        let connectedNodes = assetGraph.getNodeIdsConnectedTo(queuedNodeId);
        if (connectedNodes.length > 0) {
          queue.add(...connectedNodes);
        }
      }
    }

    return errors;
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

      return equalSet(
        new Set(asset?.dependencies.get(key)?.symbols?.keys()),
        new Set(otherAsset?.dependencies.get(key)?.symbols?.keys()),
      );
    });
  }
}

function equalSet<T>(a: $ReadOnlySet<T>, b: $ReadOnlySet<T>) {
  return a.size === b.size && [...a].every(i => b.has(i));
}

function getDependencyResolution(
  graph: AssetGraph,
  depId: ContentKey,
): Array<NodeId> {
  let depNodeId = graph.getNodeIdByContentKey(depId);
  let connected = graph.getNodeIdsConnectedFrom(depNodeId);
  invariant(connected.length <= 1);
  let child = connected[0];
  if (child) {
    let childNode = nullthrows(graph.getNode(child));
    if (childNode.type === 'asset_group') {
      return graph.getNodeIdsConnectedFrom(child);
    } else {
      return [child];
    }
  }
  return [];
}

function equalMap<K>(
  a: $ReadOnlyMap<K, ?{|asset: ContentKey, symbol: ?Symbol|}>,
  b: $ReadOnlyMap<K, ?{|asset: ContentKey, symbol: ?Symbol|}>,
) {
  if (a.size !== b.size) return false;
  for (let [k, v] of a) {
    if (!b.has(k)) return false;
    let vB = b.get(k);
    if (vB?.asset !== v?.asset || vB?.symbol !== v?.symbol) return false;
  }
  return true;
}

function setPop<T>(set: Set<T>): T {
  let v = nullthrows(set.values().next().value);
  set.delete(v);
  return v;
}
