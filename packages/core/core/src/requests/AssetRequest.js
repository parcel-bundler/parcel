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
import invariant from 'assert';

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

function generateRequestId(type, obj) {
  return `${type}:${md5FromOrderedObject(obj)}`;
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
    invalidateReason,
    // Add invalidations to the request if a node already exists in the graph.
    // These are used to compute the cache key for assets during transformation.
    invalidations: api.getInvalidations().filter(invalidation => {
      // Filter out invalidation node for the input file itself.
      return (
        invalidation.type !== 'file' || invalidation.filePath !== input.filePath
      );
    }),
    devDeps: new Map(
      await Promise.all(
        api
          .getSubRequests()
          .filter(
            req =>
              req.type === 'dev_dep_request' && api.canSkipSubrequest(req.id),
          )
          .map(async req => {
            let res = nullthrows(await api.getRequestResult(req.id));
            invariant(
              typeof res.name === 'string' && typeof res.hash === 'string',
            );
            return [res.name, res.hash];
          }),
      ),
    ),
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

  // console.log('RESULT', require('util').inspect(devDepRequests, {depth: 10, colors: true, maxArrayLength: 1000}))
  for (let devDepRequest of devDepRequests) {
    await api.runRequest<null, void>({
      id: 'dev_dep_request:' + devDepRequest.name + ':' + devDepRequest.hash,
      type: 'dev_dep_request',
      run: ({api}) => {
        for (let filePath of nullthrows(devDepRequest.invalidateOnFileChange)) {
          api.invalidateOnFileUpdate(filePath);
          api.invalidateOnFileDelete(filePath);
        }

        for (let invalidation of nullthrows(
          devDepRequest.invalidateOnFileCreate,
        )) {
          api.invalidateOnFileCreate(invalidation);
        }

        api.storeResult({
          name: devDepRequest.name,
          hash: devDepRequest.hash,
        });
      },
      input: null,
    });
  }

  // Add config requests
  for (let {request, result} of configRequests) {
    let id = generateRequestId('config_request', request);
    await api.runRequest<null, void>({
      id,
      type: 'config_request',
      run: ({api}) => {
        let {
          includedFiles,
          invalidateOnFileCreate,
          shouldInvalidateOnStartup,
        } = result;
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

    // Add dep version requests
    // TODO: add dev deps for configs
    // for (let [moduleSpecifier] of result.devDeps) {
    //   let depVersionRequst = {
    //     moduleSpecifier,
    //     resolveFrom:
    //       result.pkgFilePath != null ? result.pkgFilePath : result.searchPath,
    //   };
    //   let id = generateRequestId('dep_version_request', depVersionRequst);
    //   await api.runRequest<null, void>({
    //     id,
    //     type: 'version_request',
    //     run: ({api}) => {
    //       if (options.lockFile != null) {
    //         api.invalidateOnFileUpdate(options.lockFile);
    //       }
    //     },
    //     input: null,
    //   });
    // }
  }

  return assets;
}
