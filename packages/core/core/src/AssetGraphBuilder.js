// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {
  FilePath,
  ModuleSpecifier,
  Symbol,
  SourceLocation,
} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';
import type WorkerFarm, {Handle, SharedReference} from '@parcel/workers';
import type {Event, Options as WatcherOptions} from '@parcel/watcher';
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
  ValidationOpts,
  Target,
} from './types';
import type {ConfigAndCachePath} from './requests/ParcelConfigRequest';
import type {EntryResult} from './requests/EntryRequest';

import EventEmitter from 'events';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import {
  escapeMarkdown,
  md5FromObject,
  md5FromString,
  PromiseQueue,
  flatMap,
} from '@parcel/utils';
import ThrowableDiagnostic from '@parcel/diagnostic';
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
  name: string;

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
    this.name = name;
    this.options = options;
    this.optionsRef = optionsRef;
    this.entries = entries;
    this.initialAssetGroups = assetGroups;
    this.workerFarm = workerFarm;
    this.assetRequests = [];

    this.cacheKey = md5FromObject({
      parcelVersion: PARCEL_VERSION,
      name,
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
      this.requestGraph.invalidateOptionNodes(options);
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
    const visit = (node: AssetGraphNode) => {
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
    const visitChildren = (node: AssetGraphNode) => {
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

    // Skip symbol propagation if no target is using scope hoisting
    // (mainly for faster development builds)
    let entryDependencies = flatMap(
      flatMap(this.assetGraph.getNodesConnectedFrom(root), entrySpecifier =>
        this.assetGraph.getNodesConnectedFrom(entrySpecifier),
      ),
      entryFile =>
        this.assetGraph.getNodesConnectedFrom(entryFile).map(dep => {
          invariant(dep.type === 'dependency');
          return dep;
        }),
    );
    if (entryDependencies.some(d => d.value.env.scopeHoist)) {
      this.propagateSymbols();
    }
    dumpToGraphViz(this.assetGraph, this.name);
    // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
    dumpToGraphViz(this.requestGraph, 'RequestGraph');

    let changedAssets = this.changedAssets;
    this.changedAssets = new Map();
    return {assetGraph: this.assetGraph, changedAssets: changedAssets};
  }

  propagateSymbols() {
    // Propagate the requested symbols down from the root to the leaves
    this.propagateSymbolsDown((assetNode, incomingDeps, outgoingDeps) => {
      if (!assetNode.value.symbols) return;

      // exportSymbol -> identifier
      let assetSymbols: $ReadOnlyMap<
        Symbol,
        {|local: Symbol, loc: ?SourceLocation|},
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
      if (!assetNode.value.symbols) return [];

      let assetSymbols: $ReadOnlyMap<
        Symbol,
        {|local: Symbol, loc: ?SourceLocation|},
      > = assetNode.value.symbols;

      let assetSymbolsInverse = new Map<Symbol, Set<Symbol>>();
      for (let [s, {local}] of assetSymbols) {
        let set = assetSymbolsInverse.get(local);
        if (!set) {
          set = new Set();
          assetSymbolsInverse.set(local, set);
        }
        set.add(s);
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

          let reexported = assetSymbolsInverse.get(local);
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
              message: `${escapeMarkdown(
                path.relative(
                  this.options.projectRoot,
                  resolution.value.filePath,
                ),
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

    let queue: Array<AssetGraphNode> = [root];
    let visited = new Set<AssetGraphNode>();

    while (queue.length > 0) {
      let node = queue.shift();
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
          queue.push(child);
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
    let queue = [...dirtyDeps];
    while (queue.length > 0) {
      let node = queue.shift();

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
            queue.push(i);
          }
        }
      } else {
        queue.push(...this.assetGraph.getNodesConnectedTo(node));
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
    let targets = await this.requestTracker.runRequest<Entry, Array<Target>>(
      request,
    );
    this.assetGraph.resolveTargets(request.input, targets, request.id);
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

function equalSet<T>(a: $ReadOnlySet<T>, b: $ReadOnlySet<T>) {
  return a.size === b.size && [...a].every(i => b.has(i));
}
