// @flow strict-local
import type AssetGraph from '../AssetGraph';
import type ParcelConfig from '../ParcelConfig';
import type RequestTracker, {RequestRunnerAPI} from '../RequestTracker';
import type {AssetRequestDesc, Dependency, ParcelOptions} from '../types';

import {RequestRunner} from '../RequestTracker';
import ResolverRunner from '../ResolverRunner';

type DependencyResult = AssetRequestDesc | null | void;

export type DepPathRequest = {|
  id: string,
  +type: 'dep_path_request',
  request: Dependency,
  result?: DependencyResult,
|};

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
      this.assetGraph.resolveDependency(dependency, null, api.getId());
      return;
    }

    this.assetGraph.resolveDependency(dependency, assetGroup, api.getId());

    // ? Should this happen if asset is deferred?
    api.invalidateOnFileDelete(assetGroup.filePath);
  }
}
