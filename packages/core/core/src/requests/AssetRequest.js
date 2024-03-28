// @flow strict-local

import type {Async} from '@parcel/types';
import type {StaticRunOpts} from '../RequestTracker';
import type {
  AssetRequestInput,
  AssetRequestResult,
  DevDepRequest,
  TransformationRequest,
} from '../types';
import type {ConfigAndCachePath} from './ParcelConfigRequest';
import type {TransformationResult} from '../Transformation';

import nullthrows from 'nullthrows';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {hashString} from '@parcel/rust';
import createParcelConfigRequest from './ParcelConfigRequest';
import {runDevDepRequest} from './DevDepRequest';
import {runConfigRequest} from './ConfigRequest';
import {fromProjectPath, fromProjectPathRelative} from '../projectPath';
import {report} from '../ReporterRunner';
import {requestTypes} from '../RequestTracker';
import {Asset as DbAsset} from '@parcel/rust';

type RunInput<TResult> = {|
  input: AssetRequestInput,
  ...StaticRunOpts<TResult>,
|};

export type AssetRequest = {|
  id: string,
  +type: typeof requestTypes.asset_request,
  run: (RunInput<AssetRequestResult>) => Async<AssetRequestResult>,
  input: AssetRequestInput,
|};

export default function createAssetRequest(
  input: AssetRequestInput,
): AssetRequest {
  return {
    type: requestTypes.asset_request,
    id: getId(input),
    run,
    input,
  };
}

const type = 'asset_request';

function getId(input: AssetRequestInput) {
  // eslint-disable-next-line no-unused-vars
  let {optionsRef, ...hashInput} = input;
  return hashString(
    type +
      fromProjectPathRelative(input.filePath) +
      String(input.env) +
      String(input.isSource) +
      String(input.sideEffects) +
      (input.code ?? '') +
      ':' +
      (input.pipeline ?? '') +
      ':' +
      (input.query ?? ''),
  );
}

async function run({input, api, farm, invalidateReason, options}) {
  report({
    type: 'buildProgress',
    phase: 'transforming',
    filePath: fromProjectPath(options.projectRoot, input.filePath),
  });

  api.invalidateOnFileUpdate(input.filePath);
  let start = Date.now();
  let {optionsRef, ...rest} = input;
  let {cachePath} = nullthrows(
    await api.runRequest<null, ConfigAndCachePath>(createParcelConfigRequest()),
  );

  let previousDevDepRequests = new Map(
    await Promise.all(
      api
        .getSubRequests()
        .filter(req => req.requestType === requestTypes.dev_dep_request)
        .map(async req => [
          req.id,
          nullthrows(await api.getRequestResult<DevDepRequest>(req.id)),
        ]),
    ),
  );

  let request: TransformationRequest = {
    ...rest,
    invalidateReason,
    devDeps: new Map(
      [...previousDevDepRequests.entries()]
        .filter(([id]) => api.canSkipSubrequest(id))
        .map(([, req]) => [
          `${req.specifier}:${fromProjectPathRelative(req.resolveFrom)}`,
          req.hash,
        ]),
    ),
    invalidDevDeps: await Promise.all(
      [...previousDevDepRequests.entries()]
        .filter(([id]) => !api.canSkipSubrequest(id))
        .flatMap(([, req]) => {
          return [
            {
              specifier: req.specifier,
              resolveFrom: req.resolveFrom,
            },
            ...(req.additionalInvalidations ?? []).map(i => ({
              specifier: i.specifier,
              resolveFrom: i.resolveFrom,
            })),
          ];
        }),
    ),
  };

  let {assets, configRequests, error, invalidations, devDepRequests} =
    (await farm.createHandle(
      'runTransform',
      input.isSingleChangeRebuild,
    )({
      configCachePath: cachePath,
      optionsRef,
      request,
    }): TransformationResult);

  let time = Date.now() - start;
  if (assets) {
    for (let {asset} of assets) {
      DbAsset.get(options.db, asset).stats.time = time;
    }
  }

  for (let filePath of invalidations.invalidateOnFileChange) {
    api.invalidateOnFileUpdate(filePath);
    api.invalidateOnFileDelete(filePath);
  }

  for (let invalidation of invalidations.invalidateOnFileCreate) {
    api.invalidateOnFileCreate(invalidation);
  }

  for (let env of invalidations.invalidateOnEnvChange) {
    api.invalidateOnEnvChange(env);
  }

  for (let option of invalidations.invalidateOnOptionChange) {
    api.invalidateOnOptionChange(option);
  }

  if (invalidations.invalidateOnStartup) {
    api.invalidateOnStartup();
  }

  if (invalidations.invalidateOnBuild) {
    api.invalidateOnBuild();
  }

  for (let devDepRequest of devDepRequests) {
    await runDevDepRequest(api, devDepRequest);
  }

  for (let configRequest of configRequests) {
    await runConfigRequest(api, configRequest);
  }

  if (error != null) {
    throw new ThrowableDiagnostic({diagnostic: error});
  } else {
    return nullthrows(assets);
  }
}
