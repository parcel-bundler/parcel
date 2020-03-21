// @flow strict-local
import type AssetGraph from '../AssetGraph';
import type ParcelConfig from '../ParcelConfig';
import type RequestTracker, {RequestRunnerAPI} from '../RequestTracker';
import type {AssetRequestDesc, Dependency, ParcelOptions} from '../types';

import invariant from 'assert';
import {nodeFromAssetGroup} from '../AssetGraph';
import {RequestRunner} from '../RequestTracker';
import ResolverRunner from '../ResolverRunner';

type DependencyResult = AssetRequestDesc | null | void;

export type DepPathRequest = {|
  id: string,
  +type: 'dep_path_request',
  request: Dependency,
  result?: DependencyResult,
|};

const invertMap = <K, V>(map: Map<K, V>): Map<V, K> =>
  new Map([...map].map(([key, val]) => [val, key]));

export default class DepPathRequestRunner extends RequestRunner<
  Dependency,
  DependencyResult,
> {
  resolverRunner: ResolverRunner;
  assetGraph: AssetGraph;

  constructor(opts: {|
    tracker: RequestTracker,
    options: ParcelOptions,
    config: ParcelConfig,
    assetGraph: AssetGraph,
  |}) {
    super(opts);
    this.type = 'dep_path_request';
    let {options, config, assetGraph} = opts;
    this.resolverRunner = new ResolverRunner({
      options,
      config,
    });
    this.assetGraph = assetGraph;
  }

  run(request: Dependency) {
    return this.resolverRunner.resolve(request);
  }

  onComplete(
    request: Dependency,
    result: DependencyResult,
    api: RequestRunnerAPI,
  ) {
    let dependency = request;
    let assetGroup = result;
    if (!assetGroup) {
      this.assetGraph.resolveDependency(dependency, null);
      return;
    }

    let defer = this.shouldDeferDependency(dependency, assetGroup.sideEffects);
    dependency.isDeferred = defer;

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
      this.assetGraph.traverse((node, parent, actions) => {
        if (node == assetGroupNode) {
          return;
        }

        if (node.type === 'dependency' && !node.value.isDeferred) {
          actions.skipChildren();
          return;
        }

        if (node.type == 'asset_group') {
          invariant(parent && parent.type === 'dependency');
          if (
            node.deferred &&
            !this.shouldDeferDependency(parent.value, node.value.sideEffects)
          ) {
            parent.value.isDeferred = false;
            node.deferred = false;
            this.assetGraph.markIncomplete(node);
          }

          actions.skipChildren();
        }

        return node;
      }, assetGroupNode);
    }

    // ? Should this happen if asset is deferred?
    api.invalidateOnFileDelete(assetGroup.filePath);

    // TODO: invalidate dep path requests that have failed and a file creation may fulfill the request
  }

  // Defer transforming this dependency if it is marked as weak, there are no side effects,
  // no re-exported symbols are used by ancestor dependencies and the re-exporting asset isn't
  // using a wildcard and isn't an entry (in library mode).
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
          !(d.env.isLibrary && d.isEntry) &&
          !d.symbols.has('*') &&
          ![...d.symbols.keys()].some(symbol => {
            let assetSymbol = resolvedAsset.symbols.get(symbol);
            return assetSymbol != null && symbols.has(assetSymbol);
          }),
      );
    }
    return defer;
  }
}
