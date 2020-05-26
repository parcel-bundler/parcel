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

type RunInput = {|
  input: AssetRequestInput,
  ...StaticRunOpts,
|};

export type AssetRequest = {|
  id: string,
  +type: 'asset_request',
  run: RunInput => Promise<AssetRequestResult>,
  input: AssetRequestInput,
|};

function generateRequestId(type, obj) {
  return `${type}:${md5FromObject(obj)}`;
}

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

async function run({input, api, options, farm}: RunInput) {
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

  // Add config requests
  for (let {request, result} of configRequests) {
    let id = generateRequestId('config_request', request);
    await api.runRequest<null, void>({
      id,
      type: 'config_request',
      run: ({api}) => {
        if (result.resolvedPath != null) {
          api.invalidateOnFileUpdate(result.resolvedPath);
        }

        for (let filePath of result.includedFiles) {
          api.invalidateOnFileUpdate(filePath);
        }

        if (result.watchGlob != null) {
          api.invalidateOnFileCreate(result.watchGlob);
        }

        if (result.shouldInvalidateOnStartup) {
          api.invalidateOnStartup();
        }
      },
      input: null,
    });

    // Add dep version requests
    for (let [moduleSpecifier] of result.devDeps) {
      let depVersionRequst = {
        moduleSpecifier,
        resolveFrom: result.resolvedPath, // TODO: resolveFrom should be nearest package boundary
      };
      let id = generateRequestId('dep_version_request', depVersionRequst);
      await api.runRequest<null, void>({
        id,
        type: 'version_request',
        run: ({api}) => {
          if (options.lockFile != null) {
            api.invalidateOnFileUpdate(options.lockFile);
          }
        },
        input: null,
      });
    }
  }

  return assets;
}
