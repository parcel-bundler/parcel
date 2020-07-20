// @flow strict-local

import type {Async} from '@parcel/types';
import type {StaticRunOpts} from '../RequestTracker';
import type {AssetRequestInput, AssetRequestResult} from '../types';
import type {ConfigAndCachePath} from './ParcelConfigRequest';

import {md5FromObject} from '@parcel/utils';
import nullthrows from 'nullthrows';
import createParcelConfigRequest from './ParcelConfigRequest';

type RunInput = {|
  input: AssetRequestInput,
  ...StaticRunOpts,
|};

export type AssetRequest = {|
  id: string,
  +type: 'asset_request',
  run: RunInput => Async<AssetRequestResult>,
  input: AssetRequestInput,
|};

function generateRequestId(type, obj) {
  return `${type}:${md5FromObject(obj)}`;
}

export default function createAssetRequest(
  input: AssetRequestInput,
): AssetRequest {
  return {
    type: 'asset_request',
    id: getId(input),
    run,
    input,
  };
}

const type = 'asset_request';

function getId(input: AssetRequestInput) {
  // eslint-disable-next-line no-unused-vars
  let {optionsRef, ...hashInput} = input;
  return `${type}:${md5FromObject(hashInput)}`;
}

async function run({input, api, options, farm}: RunInput) {
  api.invalidateOnFileUpdate(await options.inputFS.realpath(input.filePath));
  let start = Date.now();
  let {optionsRef, ...request} = input;
  let {cachePath} = nullthrows(
    await api.runRequest<null, ConfigAndCachePath>(createParcelConfigRequest()),
  );
  let {assets, configRequests} = await farm.createHandle('runTransform')({
    configCachePath: cachePath,
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
        let {includedFiles, watchGlob, shouldInvalidateOnStartup} = result;
        for (let filePath of includedFiles) {
          api.invalidateOnFileUpdate(filePath);
          api.invalidateOnFileDelete(filePath);
        }

        if (watchGlob != null) {
          api.invalidateOnFileCreate(watchGlob);
        }

        if (shouldInvalidateOnStartup) {
          api.invalidateOnStartup();
        }
      },
      input: null,
    });

    // Add dep version requests
    for (let [moduleSpecifier] of result.devDeps) {
      let depVersionRequst = {
        moduleSpecifier,
        resolveFrom:
          result.pkgFilePath != null ? result.pkgFilePath : result.searchPath,
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
