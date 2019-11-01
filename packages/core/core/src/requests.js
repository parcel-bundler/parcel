// @flow strict-local

import type {FilePath} from '@parcel/types';
import type WorkerFarm from '@parcel/workers';
import type {
  AssetRequestDesc,
  AssetRequestResult,
  Dependency,
  ParcelOptions
} from './types';
import type {RequestRunner, RequestGraph} from './RequestTracker';
import type AssetGraph from './AssetGraph';
import type ParcelConfig from './ParcelConfig';
import type {TargetResolveResult} from './TargetResolver';
import type {EntryResult} from './EntryResolver'; // ? Is this right

import invariant from 'assert';
import path from 'path';
import {isGlob} from '@parcel/utils';
import {nodeFromAssetGroup} from './AssetGraph';
import ResolverRunner from './ResolverRunner';
import {EntryResolver} from './EntryResolver';
import TargetResolver from './TargetResolver';
import {generateRequestId} from './RequestTracker';

export type AssetGraphBuildRequest =
  | EntryRequest
  | TargetRequest
  | AssetRequest
  | DepPathRequest;

type EntryRequest = {|
  id: string,
  +type: 'entry_request',
  request: FilePath,
  result?: EntryResult
|};

type TargetRequest = {|
  id: string,
  +type: 'target_request',
  request: FilePath,
  result?: TargetResolveResult
|};

type AssetRequest = {|
  id: string,
  +type: 'asset_request',
  request: AssetRequestDesc,
  result?: AssetRequestResult
|};

type DepPathRequest = {|
  id: string,
  +type: 'dep_path_request',
  request: Dependency,
  result?: AssetRequestDesc
|};

export class EntryRequestRunner implements RequestRunner {
  entryResolver: EntryResolver;
  assetGraph: AssetGraph;

  constructor({
    options,
    assetGraph
  }: {|
    options: ParcelOptions,
    assetGraph: AssetGraph
  |}) {
    this.entryResolver = new EntryResolver(options);
    this.assetGraph = assetGraph;
  }

  run(request: EntryRequest) {
    return this.entryResolver.resolveEntry(request.request);
  }

  onComplete(request: EntryRequest, result: EntryResult, graph: RequestGraph) {
    this.assetGraph.resolveEntry(request.request, result.entries);

    // Connect files like package.json that affect the entry
    // resolution so we invalidate when they change.
    for (let file of result.files) {
      graph.invalidateOnFileUpdate(request, file.filePath);
    }

    // If the entry specifier is a glob, add a glob node so
    // we invalidate when a new file matches.
    if (isGlob(request.request)) {
      graph.invalidateOnFileCreate(request, request.request);
    }
  }
}

export class TargetRequestRunner implements RequestRunner {
  targetResolver: TargetResolver;
  assetGraph: AssetGraph;

  constructor({
    options,
    assetGraph
  }: {|
    options: ParcelOptions,
    assetGraph: AssetGraph
  |}) {
    this.targetResolver = new TargetResolver(options);
    this.assetGraph = assetGraph;
  }

  run(request: TargetRequest) {
    return this.targetResolver.resolve(path.dirname(request.request));
  }

  onComplete(
    request: TargetRequest,
    result: TargetResolveResult,
    graph: RequestGraph
  ) {
    this.assetGraph.resolveTargets(request.request, result.targets);

    // Connect files like package.json that affect the target
    // resolution so we invalidate when they change.
    for (let file of result.files) {
      graph.invalidateOnFileUpdate(request, file.filePath);
    }
  }
}

export class AssetRequestRunner implements RequestRunner {
  options: ParcelOptions;
  runTransform: TransformationOpts => Promise<AssetRequestResult>;
  assetGraph: AssetGraph;

  constructor({
    options,
    workerFarm,
    assetGraph
  }: {|
    options: ParcelOptions,
    workerFarm: WorkerFarm,
    assetGraph: AssetGraph
  |}) {
    this.options = options;
    this.runTransform = workerFarm.createHandle('runTransform');
    this.assetGraph = assetGraph;
  }

  async run(request: AssetRequest) {
    let start = Date.now();
    let {assets, configRequests} = await this.runTransform({
      request: request.request,
      options: this.options
    });

    let time = Date.now() - start;
    for (let asset of assets) {
      asset.stats.time = time;
    }
    return {assets, configRequests};
  }

  onComplete(
    request: AssetRequest,
    result: AssetRequestResult,
    graph: RequestGraph
  ) {
    this.assetGraph.resolveAssetGroup(request.request, result.assets);

    let {assets, configRequests} = result;

    graph.invalidateOnFileUpdate(request, request.request.filePath);

    for (let asset of assets) {
      for (let filePath of asset.includedFiles.keys()) {
        graph.invalidateOnFileUpdate(request, filePath);
        graph.invalidateOnFileDelete(request, filePath);
      }
    }

    let subrequestNodes = [];
    // Add config requests
    for (let {request, result} of configRequests) {
      let id = generateRequestId('config_request', request);
      let shouldSetupInvalidations =
        graph.invalidNodeIds.has(id) || !graph.hasNode(id);
      let subrequestNode = graph.addRequest({
        id,
        type: 'config_request',
        request,
        result
      });

      if (shouldSetupInvalidations) {
        if (result.resolvedPath != null) {
          graph.invalidateOnFileUpdate(subrequestNode, result.resolvedPath);
        }

        for (let filePath of result.includedFiles) {
          graph.invalidateOnFileUpdate(subrequestNode, filePath);
        }

        if (result.watchGlob != null) {
          graph.invalidateOnFileCreate(subrequestNode, result.watchGlob);
        }

        if (result.shouldInvalidateOnStartup) {
          graph.invalidateOnStartup(subrequestNode);
        }
      }
      subrequestNodes.push(graph.getNode(id));

      // Add dep version requests
      for (let [moduleSpecifier, version] of result.devDeps) {
        let depVersionRequst = {
          moduleSpecifier,
          resolveFrom: result.resolvedPath // TODO: resolveFrom should be nearest package boundary
        };
        let id = generateRequestId('dep_version_request', depVersionRequst);
        let shouldSetupInvalidations =
          graph.invalidNodeIds.has(id) || !graph.hasNode(id);
        let subrequestNode = graph.addRequest({
          id,
          type: 'dep_version_request',
          request: depVersionRequst,
          result: version
        });
        if (shouldSetupInvalidations) {
          if (this.options.lockFile != null) {
            graph.invalidateOnFileUpdate(subrequestNode, this.options.lockFile);
          }
        }
        subrequestNodes.push(subrequestNode);
      }
    }

    graph.replaceSubrequests(request, subrequestNodes);

    return assets;

    // TODO: add includedFiles even if it failed so we can try a rebuild if those files change
  }
}

const invertMap = <K, V>(map: Map<K, V>): Map<V, K> =>
  new Map([...map].map(([key, val]) => [val, key]));

export class DepPathRequestRunner implements RequestRunner {
  resolverRunner: ResolverRunner;
  assetGraph: AssetGraph;

  constructor({
    options,
    config,
    assetGraph
  }: {|
    options: ParcelOptions,
    config: ParcelConfig,
    assetGraph: AssetGraph
  |}) {
    this.resolverRunner = new ResolverRunner({
      options,
      config
    });
    this.assetGraph = assetGraph;
  }

  run(request: DepPathRequest) {
    return this.resolverRunner.resolve(request.request);
  }

  onComplete(
    request: DepPathRequest,
    result: AssetRequestDesc,
    graph: RequestGraph
  ) {
    let dependency = request.request;
    let assetGroup = result;
    if (!assetGroup) {
      this.assetGraph.resolveDependency(dependency, null);
      return;
    }

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
      this.assetGraph.traverse((node, parent, actions) => {
        if (node == assetGroupNode) {
          return;
        }

        if (node.type == 'asset_group') {
          invariant(parent && parent.type === 'dependency');
          if (
            node.deferred &&
            !this.shouldDeferDependency(parent.value, node.value.sideEffects)
          ) {
            node.deferred = false;
            this.assetGraph.incompleteNodeIds.add(node.id);
          }

          actions.skipChildren();
        }

        return node;
      }, assetGroupNode);
    }

    // TODO: invalidate dep path requests that have failed and a file creation may fulfill the request
    if (result) {
      graph.invalidateOnFileDelete(request, result.filePath);
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
}
