// @flow strict-local

import type {Async} from '@parcel/types';
import type {StaticRunOpts} from '../RequestTracker';
import type {
  AssetRequestInput,
  AssetRequestResult,
  TransformationRequest,
} from '../types';
import type {ConfigAndCachePath} from './ParcelConfigRequest';
import type {TransformationResult} from '../Transformation';

import {md5FromOrderedObject, objectSortedEntries} from '@parcel/utils';
import nullthrows from 'nullthrows';
import createParcelConfigRequest from './ParcelConfigRequest';
import {getDevDepRequests, runDevDepRequest} from './DevDepRequest';

type RunInput = {|
  input: AssetRequestInput,
  ...StaticRunOpts<AssetRequestResult>,
|};

export type AssetRequest = {|
  id: string,
  +type: 'asset_request',
  run: RunInput => Async<AssetRequestResult>,
  input: AssetRequestInput,
|};

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
  return md5FromOrderedObject({
    type,
    filePath: input.filePath,
    env: input.env.id,
    isSource: input.isSource,
    sideEffects: input.sideEffects,
    code: input.code,
    pipeline: input.pipeline,
    query: input.query ? objectSortedEntries(input.query) : null,
  });
}

async function run({input, api, farm, invalidateReason}: RunInput) {
  api.invalidateOnFileUpdate(input.filePath);
  let start = Date.now();
  let {optionsRef, ...rest} = input;
  let {cachePath} = nullthrows(
    await api.runRequest<null, ConfigAndCachePath>(createParcelConfigRequest()),
  );

  let request: TransformationRequest = {
    ...rest,
    ...(await getDevDepRequests(api)),
    invalidateReason,
    // Add invalidations to the request if a node already exists in the graph.
    // These are used to compute the cache key for assets during transformation.
    invalidations: api.getInvalidations().filter(invalidation => {
      // Filter out invalidation node for the input file itself.
      return (
        invalidation.type !== 'file' || invalidation.filePath !== input.filePath
      );
    }),
  };

  let {
    assets,
    configRequests,
    invalidations,
    invalidateOnFileCreate,
    devDepRequests,
  } = (await farm.createHandle('runTransform')({
    configCachePath: cachePath,
    optionsRef,
    request,
  }): TransformationResult);

  let time = Date.now() - start;
  for (let asset of assets) {
    asset.stats.time = time;
  }

  for (let invalidation of invalidateOnFileCreate) {
    api.invalidateOnFileCreate(invalidation);
  }

  for (let invalidation of invalidations) {
    switch (invalidation.type) {
      case 'file':
        api.invalidateOnFileUpdate(invalidation.filePath);
        api.invalidateOnFileDelete(invalidation.filePath);
        break;
      case 'env':
        api.invalidateOnEnvChange(invalidation.key);
        break;
      case 'option':
        api.invalidateOnOptionChange(invalidation.key);
        break;
      default:
        throw new Error(`Unknown invalidation type: ${invalidation.type}`);
    }
  }

  for (let devDepRequest of devDepRequests) {
    await runDevDepRequest(api, devDepRequest);
  }

  // Add config requests
  for (let configRequest of configRequests) {
    await api.runRequest<null, void>({
      id: 'config_request:' + configRequest.id,
      type: 'config_request',
      run: ({api}) => {
        let {
          includedFiles,
          invalidateOnFileCreate,
          shouldInvalidateOnStartup,
        } = configRequest;
        for (let filePath of includedFiles) {
          api.invalidateOnFileUpdate(filePath);
          api.invalidateOnFileDelete(filePath);
        }

        for (let invalidation of invalidateOnFileCreate) {
          api.invalidateOnFileCreate(invalidation);
        }

        if (shouldInvalidateOnStartup) {
          api.invalidateOnStartup();
        }
      },
      input: null,
    });
  }

  return assets;
}
