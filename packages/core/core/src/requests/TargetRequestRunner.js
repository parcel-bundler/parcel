// @flow strict-local
import type AssetGraph from '../AssetGraph';
import type RequestTracker, {RequestRunnerAPI} from '../RequestTracker';
import type {TargetResolveResult} from '../TargetResolver';
import type {Entry, ParcelOptions} from '../types';

import {RequestRunner} from '../RequestTracker';
import TargetResolver from '../TargetResolver';

export type TargetRequest = {|
  id: string,
  +type: 'target_request',
  request: Entry,
  result?: TargetResolveResult,
|};

export default class TargetRequestRunner extends RequestRunner<
  Entry,
  TargetResolveResult,
> {
  targetResolver: TargetResolver;
  assetGraph: AssetGraph;

  constructor(opts: {|
    tracker: RequestTracker,
    options: ParcelOptions,
    assetGraph: AssetGraph,
  |}) {
    super(opts);
    this.type = 'target_request';
    this.targetResolver = new TargetResolver(opts.options);
    this.assetGraph = opts.assetGraph;
  }

  run(request: Entry) {
    return this.targetResolver.resolve(request.packagePath);
  }

  onComplete(
    request: Entry,
    result: TargetResolveResult,
    api: RequestRunnerAPI,
  ) {
    this.assetGraph.resolveTargets(request, result.targets, api.getId());

    // Connect files like package.json that affect the target
    // resolution so we invalidate when they change.
    for (let file of result.files) {
      api.invalidateOnFileUpdate(file.filePath);
    }
  }
}
