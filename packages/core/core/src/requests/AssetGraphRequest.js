// @flow strict-local

import type {
  Async,
  FilePath,
  ModuleSpecifier,
  Symbol,
  SourceLocation,
  Meta,
} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {Diagnostic} from '@parcel/diagnostic';
import type {
  Asset,
  AssetGraphNode,
  AssetGroup,
  AssetNode,
  AssetRequestInput,
  Dependency,
  DependencyNode,
  Entry,
  ParcelOptions,
  Target,
} from '../types';
import type {StaticRunOpts, RunAPI} from '../RequestTracker';
import type {EntryResult} from './EntryRequest';
import type {PathRequestInput} from './PathRequest';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import {md5FromOrderedObject, PromiseQueue} from '@parcel/utils';
import ThrowableDiagnostic, {md} from '@parcel/diagnostic';
import AssetGraph from '../AssetGraph';
import {PARCEL_VERSION} from '../constants';
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
  shouldBuildLazily?: boolean,
  requestedAssetIds?: Set<string>,
|};

type RunInput = {|
  input: AssetGraphRequestInput,
  ...StaticRunOpts<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>,
    assetRequests: Array<AssetGroup>,
  |}>,
|};

type AssetGraphRequest = {|
  id: string,
  +type: 'asset_graph_request',
  run: RunInput => Async<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>,
    assetRequests: Array<AssetGroup>,
  |}>,
  input: AssetGraphRequestInput,
|};

export default function createAssetGraphRequest(
  input: AssetGraphRequestInput,
): AssetGraphRequest {
  return {
    type: 'asset_graph_request',
    id: input.name,
    run: input => {
      let builder = new AssetGraphBuilder(input);
      return builder.build();
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
  options: ParcelOptions;
  api: RunAPI;
  name: string;
  assetRequests: Array<AssetGroup> = [];
  cacheKey: string;
  shouldBuildLazily: boolean;
  requestedAssetIds: Set<string>;

  constructor({input, prevResult, api, options}: RunInput) {
    let {
      entries,
      assetGroups,
      optionsRef,
      name,
      requestedAssetIds,
      shouldBuildLazily,
    } = input;
    let assetGraph = prevResult?.assetGraph ?? new AssetGraph();
    assetGraph.setRootConnections({
      entries,
      assetGroups,
    });
    this.assetGraph = assetGraph;
    this.optionsRef = optionsRef;
    this.options = options;
    this.api = api;
    this.name = name;
    this.requestedAssetIds = requestedAssetIds ?? new Set();
    this.shouldBuildLazily = shouldBuildLazily ?? false;

    this.cacheKey = md5FromOrderedObject({
      parcelVersion: PARCEL_VERSION,
      name,
      entries,
    });

    this.queue = new PromiseQueue();
  }

  async build(): Promise<{|
    assetGraph: AssetGraph,
    changedAssets: Map<string, Asset>,
    assetRequests: Array<AssetGroup>,
  |}> {
    let errors = [];

    let root = this.assetGraph.getRootNode();
    if (!root) {
      throw new Error('A root node is required to traverse');
    }

    let visited = new Set([root.id]);
    const visit = (node: AssetGraphNode) => {
      if (errors.length > 0) {
        return;
      }

      if (this.shouldSkipRequest(node)) {
        visitChildren(node);
      } else {
        // ? do we need to visit children inside of the promise that is queued?
        this.queueCorrespondingRequest(node, errors).then(() =>
          visitChildren(node),
        );
      }
    };
    const visitChildren = (node: AssetGraphNode) => {
      for (let child of this.assetGraph.getNodesConnectedFrom(node)) {
        if (
          (!visited.has(child.id) || child.hasDeferred) &&
          this.shouldVisitChild(node, child)
        ) {
          visited.add(child.id);
          visit(child);
        }
      }
    };

    visit(root);
    await this.queue.run();

    this.api.storeResult(
      {
        assetGraph: this.assetGraph,
        changedAssets: new Map(),
        assetRequests: [],
      },
      this.cacheKey,
    );

    if (errors.length) {
      throw errors[0]; // TODO: eventually support multiple errors since requests could reject in parallel
    }
    // Skip symbol propagation if no target is using scope hoisting
    // (mainly for faster development builds)
    let entryDependencies = this.assetGraph
      .getNodesConnectedFrom(root)
      .flatMap(entrySpecifier =>
        this.assetGraph.getNodesConnectedFrom(entrySpecifier),
      )
      .flatMap(entryFile =>
        this.assetGraph.getNodesConnectedFrom(entryFile).map(dep => {
          invariant(dep.type === 'dependency');
          return dep;
        }),
      );
    if (entryDependencies.some(d => d.value.env.shouldScopeHoist)) {
      try {
        this.propagateSymbols();
      } catch (e) {
        dumpToGraphViz(this.assetGraph, 'AssetGraph_' + this.name + '_failed');
        throw e;
      }
    }
    dumpToGraphViz(this.assetGraph, 'AssetGraph_' + this.name);

    return {
      assetGraph: this.assetGraph,
      changedAssets: this.changedAssets,
      assetRequests: this.assetRequests,
    };
  }

  shouldVisitChild(node: AssetGraphNode, child: AssetGraphNode): boolean {
    if (this.shouldBuildLazily) {
      if (node.type === 'asset' && child.type === 'dependency') {
        if (this.requestedAssetIds.has(node.value.id)) {
          node.requested = true;
        } else if (!node.requested) {
          let isAsyncChild = this.assetGraph
            .getIncomingDependencies(node.value)
            .every(dep => dep.isEntry || dep.isAsync);
          if (isAsyncChild) {
            node.requested = false;
          } else {
            delete node.requested;
          }
        }

        let previouslyDeferred = child.deferred;
        child.deferred = node.requested === false;

        if (!previouslyDeferred && child.deferred) {
          this.assetGraph.markParentsWithHasDeferred(child);
        } else if (previouslyDeferred && !child.deferred) {
          this.assetGraph.unmarkParentsWithHasDeferred(child);
        }

        return !child.deferred;
      }
    }

    return this.assetGraph.shouldVisitChild(node, child);
  }

  propagateSymbols() {
    // Propagate the requested symbols down from the root to the leaves
    this.propagateSymbolsDown((assetNode, incomingDeps, outgoingDeps) => {
      if (!assetNode.value.symbols) return;

      // exportSymbol -> identifier
      let assetSymbols: $ReadOnlyMap<
        Symbol,
        {|local: Symbol, loc: ?SourceLocation, meta?: ?Meta|},
      > = assetNode.value.symbols;
      // identifier -> exportSymbol
      let assetSymbolsInverse;
      assetSymbolsInverse = new Map<Symbol, Set<Symbol>>();
      for (let [s, {local}] of assetSymbols) {
        let set = assetSymbolsInverse.get(local);
        if (!set) {
          set = new Set();
          assetSymbolsInverse.set(local, set);
        }
        set.add(s);
      }
      let hasNamespaceOutgoingDeps = outgoingDeps.some(
        d => d.value.symbols?.get('*')?.local === '*',
      );

      // 1) Determine what the incomingDeps requests from the asset
      // ----------------------------------------------------------

      let isEntry = false;

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
            isEntry = true;
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

      // 2) Distribute the symbols to the outgoing dependencies
      // ----------------------------------------------------------
      for (let dep of outgoingDeps) {
        let depUsedSymbolsDownOld = dep.usedSymbolsDown;
        let depUsedSymbolsDown = new Set();
        dep.usedSymbolsDown = depUsedSymbolsDown;
        if (
          assetNode.value.sideEffects ||
          // For entries, we still need to add dep.value.symbols of the entry (which are "used" but not according to the symbols data)
          isEntry ||
          // If not a single asset is used, we can say the entire subgraph is not used.
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
            for (let s of namespaceReexportedSymbols) {
              // We need to propagate the namespaceReexportedSymbols to all namespace dependencies (= even wrong ones because we don't know yet)
              depUsedSymbolsDown.add(s);
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
        if (!equalSet(depUsedSymbolsDownOld, depUsedSymbolsDown)) {
          dep.usedSymbolsDownDirty = true;
          dep.usedSymbolsUpDirtyDown = true;
        }
      }
    });

    // Because namespace reexports introduce ambiguity, go up the graph from the leaves to the
    // root and remove requested symbols that aren't actually exported
    this.propagateSymbolsUp((assetNode, incomingDeps, outgoingDeps) => {
      let assetSymbols: ?$ReadOnlyMap<
        Symbol,
        {|local: Symbol, loc: ?SourceLocation, meta?: ?Meta|},
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

      let reexportedSymbols = new Set<Symbol>();
      for (let outgoingDep of outgoingDeps) {
        let outgoingDepSymbols = outgoingDep.value.symbols;
        if (!outgoingDepSymbols) continue;

        // excluded, assume everything that is requested exists
        if (this.assetGraph.getNodesConnectedFrom(outgoingDep).length === 0) {
          outgoingDep.usedSymbolsDown.forEach(s =>
            outgoingDep.usedSymbolsUp.add(s),
          );
        }

        if (outgoingDepSymbols.get('*')?.local === '*') {
          outgoingDep.usedSymbolsUp.forEach(s => reexportedSymbols.add(s));
        }

        for (let s of outgoingDep.usedSymbolsUp) {
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
            reexported.forEach(s => reexportedSymbols.add(s));
          }
        }
      }

      let errors = [];

      for (let incomingDep of incomingDeps) {
        let incomingDepUsedSymbolsUpOld = incomingDep.usedSymbolsUp;
        incomingDep.usedSymbolsUp = new Set();
        let incomingDepSymbols = incomingDep.value.symbols;
        if (!incomingDepSymbols) continue;

        let hasNamespaceReexport = incomingDepSymbols.get('*')?.local === '*';
        for (let s of incomingDep.usedSymbolsDown) {
          if (
            assetSymbols == null || // Assume everything could be provided if symbols are cleared
            assetNode.usedSymbols.has(s) ||
            reexportedSymbols.has(s) ||
            s === '*'
          ) {
            incomingDep.usedSymbolsUp.add(s);
          } else if (!hasNamespaceReexport) {
            let loc = incomingDep.value.symbols?.get(s)?.loc;
            let [resolution] = this.assetGraph.getNodesConnectedFrom(
              incomingDep,
            );
            invariant(resolution && resolution.type === 'asset_group');

            errors.push({
              message: md`${path.relative(
                this.options.projectRoot,
                resolution.value.filePath,
              )} does not export '${s}'`,
              origin: '@parcel/core',
              filePath: loc?.filePath,
              language: assetNode.value.type,
              codeFrame: loc
                ? {
                    codeHighlights: [
                      {
                        start: loc.start,
                        end: loc.end,
                      },
                    ],
                  }
                : undefined,
            });
          }
        }

        if (!equalSet(incomingDepUsedSymbolsUpOld, incomingDep.usedSymbolsUp)) {
          incomingDep.usedSymbolsUpDirtyUp = true;
        }

        incomingDep.excluded = false;
        if (
          incomingDep.value.symbols != null &&
          incomingDep.usedSymbolsUp.size === 0
        ) {
          let assetGroups = this.assetGraph.getNodesConnectedFrom(incomingDep);
          if (assetGroups.length === 1) {
            let [assetGroup] = assetGroups;
            invariant(assetGroup.type === 'asset_group');
            if (assetGroup.value.sideEffects === false) {
              incomingDep.excluded = true;
            }
          } else {
            invariant(assetGroups.length === 0);
          }
        }
      }
      return errors;
    });
  }

  propagateSymbolsDown(
    visit: (
      node: AssetNode,
      incoming: $ReadOnlyArray<DependencyNode>,
      outgoing: $ReadOnlyArray<DependencyNode>,
    ) => void,
  ) {
    let root = this.assetGraph.getRootNode();
    if (!root) {
      throw new Error('A root node is required to traverse');
    }

    let queue: Set<AssetGraphNode> = new Set([root]);
    let visited = new Set<AssetGraphNode>();

    while (queue.size > 0) {
      let node = nullthrows(queue.values().next().value);
      queue.delete(node);
      let outgoing = this.assetGraph.getNodesConnectedFrom(node);

      let wasNodeDirty = false;
      if (node.type === 'dependency' || node.type === 'asset_group') {
        wasNodeDirty = node.usedSymbolsDownDirty;
        node.usedSymbolsDownDirty = false;
      } else if (node.type === 'asset' && node.usedSymbolsDownDirty) {
        visit(
          node,
          this.assetGraph.getIncomingDependencies(node.value).map(d => {
            let dep = this.assetGraph.getNode(d.id);
            invariant(dep && dep.type === 'dependency');
            return dep;
          }),
          outgoing.map(dep => {
            invariant(dep.type === 'dependency');
            return dep;
          }),
        );
        node.usedSymbolsDownDirty = false;
      }

      visited.add(node);
      for (let child of outgoing) {
        let childDirty = false;
        if (
          (child.type === 'asset' || child.type === 'asset_group') &&
          wasNodeDirty
        ) {
          child.usedSymbolsDownDirty = true;
          childDirty = true;
        } else if (child.type === 'dependency') {
          childDirty = child.usedSymbolsDownDirty;
        }
        if (!visited.has(child) || childDirty) {
          queue.add(child);
        }
      }
    }
  }

  propagateSymbolsUp(
    visit: (
      node: AssetNode,
      incoming: $ReadOnlyArray<DependencyNode>,
      outgoing: $ReadOnlyArray<DependencyNode>,
    ) => Array<Diagnostic>,
  ): void {
    let root = this.assetGraph.getRootNode();
    if (!root) {
      throw new Error('A root node is required to traverse');
    }

    let errors = new Map<AssetNode, Array<Diagnostic>>();

    let dirtyDeps = new Set<DependencyNode>();
    let visited = new Set([root.id]);
    // post-order dfs
    const walk = (node: AssetGraphNode) => {
      let outgoing = this.assetGraph.getNodesConnectedFrom(node);
      for (let child of outgoing) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          walk(child);
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
        let incoming = this.assetGraph
          .getIncomingDependencies(node.value)
          .map(d => {
            let n = this.assetGraph.getNode(d.id);
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
          node.usedSymbolsUpDirty = false;
          let e = visit(
            node,
            incoming,
            outgoing.map(dep => {
              invariant(dep.type === 'dependency');
              return dep;
            }),
          );
          if (e.length > 0) {
            errors.set(node, e);
          } else {
            errors.delete(node);
          }
        }
      } else if (node.type === 'dependency') {
        if (node.usedSymbolsUpDirtyUp) {
          dirtyDeps.add(node);
        } else {
          dirtyDeps.delete(node);
        }
      }
    };
    walk(root);
    // traverse circular dependencies if neccessary (anchestors of `dirtyDeps`)
    visited = new Set();
    let queue = new Set(dirtyDeps);
    while (queue.size > 0) {
      let node = nullthrows(queue.values().next().value);
      queue.delete(node);

      visited.add(node);
      if (node.type === 'asset') {
        let incoming = this.assetGraph
          .getIncomingDependencies(node.value)
          .map(d => {
            let n = this.assetGraph.getNode(d.id);
            invariant(n && n.type === 'dependency');
            return n;
          });
        let outgoing = this.assetGraph.getNodesConnectedFrom(node).map(dep => {
          invariant(dep.type === 'dependency');
          return dep;
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
            errors.set(node, e);
          } else {
            errors.delete(node);
          }
        }
        for (let i of incoming) {
          if (i.usedSymbolsUpDirtyUp) {
            queue.add(i);
          }
        }
      } else {
        for (let connectedNode of this.assetGraph.getNodesConnectedTo(node)) {
          queue.add(connectedNode);
        }
      }
    }
    // Just throw the first error. Since errors can bubble (e.g. reexporting a reexported symbol also fails),
    // determining which failing export is the root cause is nontrivial (because of circular dependencies).
    if (errors.size > 0) {
      throw new ThrowableDiagnostic({
        diagnostic: [...errors.values()][0],
      });
    }
  }

  shouldSkipRequest(node: AssetGraphNode): boolean {
    return (
      node.complete === true ||
      !typesWithRequests.has(node.type) ||
      (node.correspondingRequest != null &&
        this.api.canSkipSubrequest(node.correspondingRequest))
    );
  }

  queueCorrespondingRequest(
    node: AssetGraphNode,
    errors: Array<Error>,
  ): Promise<mixed> {
    let promise;
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

  async runEntryRequest(input: ModuleSpecifier) {
    let request = createEntryRequest(input);
    let result = await this.api.runRequest<FilePath, EntryResult>(request, {
      force: true,
    });
    this.assetGraph.resolveEntry(request.input, result.entries, request.id);
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
    });
    let assets = await this.api.runRequest<AssetRequestInput, Array<Asset>>(
      request,
      {force: true},
    );

    if (assets != null) {
      for (let asset of assets) {
        this.changedAssets.set(asset.id, asset);
      }
      this.assetGraph.resolveAssetGroup(input, assets, request.id);
    }
  }
}

function equalSet<T>(a: $ReadOnlySet<T>, b: $ReadOnlySet<T>) {
  return a.size === b.size && [...a].every(i => b.has(i));
}
