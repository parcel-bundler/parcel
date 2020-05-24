// @flow strict-local
import type WorkerFarm from '@parcel/workers';
import type AssetGraph from '../AssetGraph';
import type RequestTracker, {RequestRunnerAPI} from '../RequestTracker';
import type {
  AssetRequestDesc,
  AssetRequestResult,
  ParcelOptions,
  TransformationOpts,
} from '../types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {RequestRunner, generateRequestId} from '../RequestTracker';

export type AssetRequest = {|
  id: string,
  +type: 'asset_request',
  request: AssetRequestDesc,
  result?: AssetRequestResult,
|};

export default class AssetRequestRunner extends RequestRunner<
  AssetRequestDesc,
  AssetRequestResult,
> {
  options: ParcelOptions;
  optionsRef: number;
  configRef: number;
  runTransform: TransformationOpts => Promise<AssetRequestResult>;
  assetGraph: AssetGraph;

  constructor(opts: {|
    tracker: RequestTracker,
    options: ParcelOptions,
    optionsRef: number,
    configRef: number,
    workerFarm: WorkerFarm,
    assetGraph: AssetGraph,
  |}) {
    super(opts);
    this.type = 'asset_request';
    this.options = opts.options;
    this.optionsRef = opts.optionsRef;
    this.configRef = opts.configRef;
    this.runTransform = opts.workerFarm.createHandle('runTransform');
    this.assetGraph = opts.assetGraph;
  }

  async run(request: AssetRequestDesc, api: RequestRunnerAPI) {
    api.invalidateOnFileUpdate(
      await this.options.inputFS.realpath(request.filePath),
    );
    let start = Date.now();
    let {assets, configRequests} = await this.runTransform({
      request: request,
      optionsRef: this.optionsRef,
      configRef: this.configRef,
    });

    let time = Date.now() - start;
    for (let asset of assets) {
      asset.stats.time = time;
    }
    return {assets, configRequests};
  }

  onComplete(
    request: AssetRequestDesc,
    result: AssetRequestResult,
    api: RequestRunnerAPI,
  ) {
    this.assetGraph.resolveAssetGroup(request, result.assets, api.getId());

    let {assets, configRequests} = result;

    for (let asset of assets) {
      for (let filePath of asset.includedFiles.keys()) {
        api.invalidateOnFileUpdate(filePath);
        api.invalidateOnFileDelete(filePath);
      }
    }

    // TODO: this should no longer be needed once we have ConfigRequestRunner
    let graph = this.tracker.graph;
    let subrequestNodes = [];
    // Add config requests
    for (let {request, result} of configRequests) {
      let id = generateRequestId('config_request', request);
      let shouldSetupInvalidations =
        graph.invalidNodeIds.has(id) || !graph.hasNode(id);
      let subrequestNode = nullthrows(
        graph.addRequest({
          id,
          type: 'config_request',
          request,
          result,
        }),
      );
      invariant(subrequestNode.type === 'request');

      if (shouldSetupInvalidations) {
        for (let filePath of result.includedFiles) {
          graph.invalidateOnFileUpdate(subrequestNode.id, filePath);
        }

        if (result.watchGlob != null) {
          graph.invalidateOnFileCreate(subrequestNode.id, result.watchGlob);
        }

        if (result.shouldInvalidateOnStartup) {
          graph.invalidateOnStartup(subrequestNode.id);
        }
      }
      subrequestNodes.push(subrequestNode);

      // Add dep version requests
      for (let [moduleSpecifier, version] of result.devDeps) {
        let depVersionRequst = {
          moduleSpecifier,
          resolveFrom:
            result.pkgFilePath != null ? result.pkgFilePath : result.searchPath,
        };
        let id = generateRequestId('dep_version_request', depVersionRequst);
        let shouldSetupInvalidations =
          graph.invalidNodeIds.has(id) || !graph.hasNode(id);
        let subrequestNode = nullthrows(
          graph.addRequest({
            id,
            type: 'dep_version_request',
            request: depVersionRequst,
            result: version,
          }),
        );
        invariant(subrequestNode.type === 'request');
        if (shouldSetupInvalidations) {
          if (this.options.lockFile != null) {
            graph.invalidateOnFileUpdate(
              subrequestNode.id,
              this.options.lockFile,
            );
          }
        }
        subrequestNodes.push(subrequestNode);
      }
    }

    api.replaceSubrequests(subrequestNodes);

    // TODO: add includedFiles even if it failed so we can try a rebuild if those files change
  }
}
