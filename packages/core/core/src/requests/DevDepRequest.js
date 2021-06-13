// @flow
import type {DevDepOptions, DependencySpecifier, FilePath} from '@parcel/types';
import type ParcelConfig from '../ParcelConfig';
import type {DevDepRequest, ParcelOptions} from '../types';
import type {RunAPI} from '../RequestTracker';

import nullthrows from 'nullthrows';
import {getInvalidationHash} from '../assetUtils';
import {createBuildCache} from '../buildCache';

export async function createDevDependency(
  opts: DevDepOptions,
  plugin: {name: DependencySpecifier, resolveFrom: FilePath, ...},
  requestDevDeps: Map<string, string>,
  options: ParcelOptions,
): Promise<DevDepRequest> {
  let {specifier, resolveFrom, invalidateParcelPlugin} = opts;
  let key = `${specifier}:${resolveFrom}`;

  // If the request sent us a hash, we know the dev dep and all of its dependencies didn't change.
  // Reuse the same hash in the response. No need to send back invalidations as the request won't
  // be re-run anyway.
  let hash = requestDevDeps.get(key);
  if (hash != null) {
    return {
      specifier,
      resolveFrom,
      hash,
    };
  }

  // Ensure that the package manager has an entry for this resolution.
  await options.packageManager.resolve(specifier, resolveFrom);
  let invalidations = options.packageManager.getInvalidations(
    specifier,
    resolveFrom,
  );

  // It is possible for a transformer to have multiple different hashes due to
  // different dependencies (e.g. conditional requires) so we must always
  // recompute the hash and compare rather than only sending a transformer
  // dev dependency once.
  hash = await getInvalidationHash(
    [...invalidations.invalidateOnFileChange].map(f => ({
      type: 'file',
      filePath: f,
    })),
    options,
  );

  let devDepRequest: DevDepRequest = {
    specifier,
    resolveFrom,
    hash,
    invalidateOnFileCreate: invalidations.invalidateOnFileCreate,
    invalidateOnFileChange: invalidations.invalidateOnFileChange,
  };

  // Optionally also invalidate the parcel plugin that is loading the config
  // when this dev dep changes (e.g. to invalidate local caches).
  if (invalidateParcelPlugin) {
    devDepRequest.additionalInvalidations = [
      {
        specifier: plugin.name,
        resolveFrom: plugin.resolveFrom,
      },
    ];
  }

  return devDepRequest;
}

export type DevDepSpecifier = {|
  specifier: DependencySpecifier,
  resolveFrom: FilePath,
|};

type DevDepRequests = {|
  devDeps: Map<string, string>,
  invalidDevDeps: Array<DevDepSpecifier>,
|};

export async function getDevDepRequests(api: RunAPI): Promise<DevDepRequests> {
  let previousDevDepRequests = new Map(
    await Promise.all(
      api
        .getSubRequests()
        .filter(req => req.type === 'dev_dep_request')
        .map(async req => [
          req.id,
          nullthrows(await api.getRequestResult<DevDepRequest>(req.id)),
        ]),
    ),
  );

  return {
    devDeps: new Map(
      [...previousDevDepRequests.entries()]
        .filter(([id]) => api.canSkipSubrequest(id))
        .map(([, req]) => [`${req.specifier}:${req.resolveFrom}`, req.hash]),
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
            ...(req.additionalInvalidations ?? []),
          ];
        }),
    ),
  };
}

// Tracks dev deps that have been invalidated during this build
// so we don't invalidate the require cache more than once.
const invalidatedDevDeps = createBuildCache();

export function invalidateDevDeps(
  invalidDevDeps: Array<DevDepSpecifier>,
  options: ParcelOptions,
  config: ParcelConfig,
) {
  for (let {specifier, resolveFrom} of invalidDevDeps) {
    let key = `${specifier}:${resolveFrom}`;
    if (!invalidatedDevDeps.has(key)) {
      config.invalidatePlugin(specifier);
      options.packageManager.invalidate(specifier, resolveFrom);
      invalidatedDevDeps.set(key, true);
    }
  }
}

export async function runDevDepRequest(
  api: RunAPI,
  devDepRequest: DevDepRequest,
) {
  await api.runRequest<null, void>({
    id: 'dev_dep_request:' + devDepRequest.specifier + ':' + devDepRequest.hash,
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
        specifier: devDepRequest.specifier,
        resolveFrom: devDepRequest.resolveFrom,
        hash: devDepRequest.hash,
        additionalInvalidations: devDepRequest.additionalInvalidations,
      });
    },
    input: null,
  });
}

// A cache of plugin dependency hashes that we've already sent to the main thread.
// Automatically cleared before each build.
const pluginCache = createBuildCache();

export function getWorkerDevDepRequests(
  devDepRequests: Array<DevDepRequest>,
): Array<DevDepRequest> {
  return devDepRequests.map(devDepRequest => {
    // If we've already sent a matching transformer + hash to the main thread during this build,
    // there's no need to repeat ourselves.
    let {specifier, resolveFrom, hash} = devDepRequest;
    if (hash === pluginCache.get(specifier)) {
      return {specifier, resolveFrom, hash};
    } else {
      pluginCache.set(specifier, hash);
      return devDepRequest;
    }
  });
}
