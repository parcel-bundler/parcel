// @flow strict-local
import type WorkerFarm from '@parcel/workers';
import type {StaticRunOpts} from '../RequestTracker';
import type {
  Asset,
  AssetRequestInput,
  AssetRequestResult,
  Config,
  ConfigRequestDesc,
  TransformationOpts,
} from '../types';

import {md5FromObject} from '@parcel/utils';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import {generateRequestId} from '../RequestTracker';

type RunInput = {|
  input: AssetRequestInput,
  ...StaticRunOpts,
|};

export type AssetRequestType = {|
  id: string,
  +type: 'asset_request',
  run: RunInput => Promise<AssetRequestResult>,
  input: AssetRequestInput,
|};

export default function createAssetRequest(input: AssetRequestInput) {
  return {
    type: 'asset_request',
    id: getId(input),
    run,
    input,
  };
}

let handle;
function getRunTransform(
  farm: WorkerFarm,
): TransformationOpts => Promise<{|
  assets: Array<Asset>,
  configRequests: Array<{|request: ConfigRequestDesc, result: Config|}>,
|}> {
  if (handle != null) {
    return handle;
  }

  handle = farm.createHandle('runTransform');
  return handle;
  // ? Could this singleton cause problems
}

const type = 'asset_request';

function getId(input: AssetRequestInput) {
  // eslint-disable-next-line no-unused-vars
  let {optionsRef, configRef, ...hashInput} = input;
  return `${type}:${md5FromObject(hashInput)}`;
}

async function run({input, api, options, farm, graph}: RunInput) {
  api.invalidateOnFileUpdate(await options.inputFS.realpath(input.filePath));
  let start = Date.now();
  let {configRef, optionsRef, ...request} = input;
  let {assets, configRequests} = await getRunTransform(farm)({
    configRef,
    optionsRef,
    request,
  });

  let time = Date.now() - start;
  for (let asset of assets) {
    asset.stats.time = time;
  }

  for (let asset of assets) {
    for (let filePath of asset.includedFiles.keys()) {
      api.invalidateOnFileUpdate(filePath);
      api.invalidateOnFileDelete(filePath);
    }
  }

  // TODO: this should no longer be needed once we have ConfigRequestRunner
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
      if (result.resolvedPath != null) {
        graph.invalidateOnFileUpdate(subrequestNode.id, result.resolvedPath);
      }

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
        resolveFrom: result.resolvedPath, // TODO: resolveFrom should be nearest package boundary
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
        if (options.lockFile != null) {
          graph.invalidateOnFileUpdate(subrequestNode.id, options.lockFile);
        }
      }
      subrequestNodes.push(subrequestNode);
    }
  }

  api.replaceSubrequests(subrequestNodes);

  return assets;
}
