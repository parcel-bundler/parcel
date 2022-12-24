// @flow

import type {Diagnostic} from '@parcel/diagnostic';
import type {ContentKey, NodeId} from '@parcel/graph';
import type {Symbol, Meta} from '@parcel/types';
import type {
  AssetNode,
  DependencyNode,
  InternalSourceLocation,
  ParcelOptions,
} from './types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import logger from '@parcel/logger';
import ThrowableDiagnostic, {md} from '@parcel/diagnostic';
import {type Asset, BundleBehavior} from './types';
import {type default as AssetGraph} from './AssetGraph';
import {fromProjectPathRelative, fromProjectPath} from './projectPath';

export function propagateSymbols(
  options: ParcelOptions,
  changedAssets: Map<string, Asset>,
  assetGraph: AssetGraph,
) {
  // Keep track of dependencies that have changes to their used symbols,
  // so we can sort them after propagation.
  let changedDeps = new Set<DependencyNode>();

  // Propagate the requested symbols down from the root to the leaves
  propagateSymbolsDown(
    assetGraph,
    changedAssets,
    (assetNode, incomingDeps, outgoingDeps) => {
      if (!assetNode.value.symbols) return;

      // exportSymbol -> identifier
      let assetSymbols: $ReadOnlyMap<
        Symbol,
        {|local: Symbol, loc: ?InternalSourceLocation, meta?: ?Meta|},
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
  propagateSymbolsUp(assetGraph, (assetNode, incomingDeps, outgoingDeps) => {
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
            valueOld?.asset === value.asset && valueOld?.symbol === value.symbol
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
                    language: incomingDep.value.sourceAssetType ?? undefined,
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

      if (!equalMap(incomingDepUsedSymbolsUpOld, incomingDep.usedSymbolsUp)) {
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
  });
  // Sort usedSymbolsUp so they are a consistent order across builds.
  // This ensures a consistent ordering of these symbols when packaging.
  // See https://github.com/parcel-bundler/parcel/pull/8212
  for (let dep of changedDeps) {
    dep.usedSymbolsUp = new Map(
      [...dep.usedSymbolsUp].sort(([a], [b]) => a.localeCompare(b)),
    );
  }
}

function propagateSymbolsDown(
  assetGraph: AssetGraph,
  changedAssets: Map<string, Asset>,
  visit: (
    assetNode: AssetNode,
    incoming: $ReadOnlyArray<DependencyNode>,
    outgoing: $ReadOnlyArray<DependencyNode>,
  ) => void,
) {
  // We care about changed assets and their changed dependencies. So start with the first changed
  // asset, which is also (one of) the root assets for initial builds, and continue while the
  // symbols change. If the queue becomes empty, continue with the next unvisited changed asset.
  //
  // In the end, nodes, which are neither listed in changedAssets nor reached via a dirty flag,
  // don't have to be visited at all.

  let unreachedChangedAssets = new Set(
    [...changedAssets.keys()].map(id => assetGraph.getNodeIdByContentKey(id)),
  );
  let queue = new Set([setPop(unreachedChangedAssets)]);

  while (queue.size > 0) {
    let queuedNodeId = setPop(queue);
    unreachedChangedAssets.delete(queuedNodeId);

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

    if (queue.size === 0 && unreachedChangedAssets.size > 0) {
      queue.add(setPop(unreachedChangedAssets));
    }
  }
}

function propagateSymbolsUp(
  assetGraph: AssetGraph,
  visit: (
    assetNode: AssetNode,
    incoming: $ReadOnlyArray<DependencyNode>,
    outgoing: $ReadOnlyArray<DependencyNode>,
  ) => Array<Diagnostic>,
): void {
  // Traverse the graph in a post-order DFS, with the idea that all children of a node should have
  // been processed first. With a tree, this would result in a minimal amount of work (processing
  // every asset exactly once).
  //
  // For graphs in general (so with cyclic dependencies), some nodes will have to be revisited. So
  // after the tree traversal, just run a regular queue-based BFS for anything that's still dirty
  // (in the hope that this affects only a small part of the graph).

  let errors = new Map<NodeId, Array<Diagnostic>>();
  let dirtyDeps = new Set<NodeId>();

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
      let incoming = assetGraph.getIncomingDependencies(node.value).map(d => {
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
    } else if (node.type === 'dependency') {
      if (node.usedSymbolsUpDirtyUp) {
        dirtyDeps.add(nodeId);
      } else {
        dirtyDeps.delete(nodeId);
      }
    }
  };
  walk(rootNodeId);

  // traverse circular dependencies if necessary (ancestors of `dirtyDeps`)
  let queue = new Set(dirtyDeps);
  while (queue.size > 0) {
    let queuedNodeId = setPop(queue);
    let node = nullthrows(assetGraph.getNode(queuedNodeId));
    if (node.type === 'asset') {
      let incoming = assetGraph.getIncomingDependencies(node.value).map(dep => {
        let depNode = assetGraph.getNodeByContentKey(dep.id);
        invariant(depNode && depNode.type === 'dependency');
        return depNode;
      });
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

  // Just throw the first error. Since errors can bubble (e.g. reexporting a reexported symbol also fails),
  // determining which failing export is the root cause is nontrivial (because of circular dependencies).
  if (errors.size > 0) {
    throw new ThrowableDiagnostic({
      diagnostic: [...errors.values()][0],
    });
  }
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

function equalSet<T>(a: $ReadOnlySet<T>, b: $ReadOnlySet<T>) {
  return a.size === b.size && [...a].every(i => b.has(i));
}

function setPop<T>(set: Set<T>): T {
  let v = nullthrows(set.values().next().value);
  set.delete(v);
  return v;
}
