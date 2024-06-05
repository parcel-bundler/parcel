// @flow strict-local

import type {Cache} from '@parcel/types';
import logger from '@parcel/logger';

/**
 * We keep track of the latest request tracker cache entry cache key.
 */
export type RequestTrackerCacheInfo = {|
  requestGraphKey: string,
  snapshotKey: string,
  allLargeBlobKeys: string[],
  timestamp: number,
|};

/**
 * On the FSCache implementation, only HEX strings are valid as keys.
 *
 * Non-hex strings will fail silently. That is a leaky abstraction and therefore
 * this function is required here to fix it.
 */
function toFsCacheKey(key: string): string {
  let result = '';
  for (let i = 0; i < key.length; i += 1) {
    result += key.charCodeAt(i).toString(16);
  }
  return result;
}

/**
 * Retrieve the latest `RequestTrackerCacheInfo`. This should help debugging
 * tools like `parcel-query` find the latest cache entries for the request
 * graph.
 */
export function getRequestTrackerCacheInfo(
  cache: Cache,
): Promise<RequestTrackerCacheInfo | void | null> {
  return cache.get(toFsCacheKey('RequestTrackerCacheInfo'));
}

/**
 * Store latest `RequestTrackerCacheInfo`, this contains the cache key for the
 * last request graph so that parcel-query can read it.
 */
export async function storeRequestTrackerCacheInfo(
  cache: Cache,
  requestTrackerCacheInfo: RequestTrackerCacheInfo,
) {
  logger.verbose({
    origin: '@parcel/core',
    message: `Storing RequestTrackerCache info`,
    meta: {
      requestGraphKey: requestTrackerCacheInfo.requestGraphKey,
      snapshotKey: requestTrackerCacheInfo.snapshotKey,
    },
  });
  await cache.set(
    toFsCacheKey('RequestTrackerCacheInfo'),
    requestTrackerCacheInfo,
  );
}

/**
 * When starting a build the request tracker cache keys are cleared.
 * This prevents dangling references from being present if the process exits
 * while writing the cache.
 *
 * This also cleans-up all the large blobs on disk, including dangling node
 * entries.
 */
export async function clearRequestTrackerCacheInfo(cache: Cache) {
  const requestTrackerCacheInfo = await getRequestTrackerCacheInfo(cache);
  await cache.set(toFsCacheKey('RequestTrackerCacheInfo'), null);

  await cache.deleteLargeBlob(requestTrackerCacheInfo.requestGraphKey);
  for (let largeBlobKey of requestTrackerCacheInfo.allLargeBlobKeys) {
    await cache.deleteLargeBlob(largeBlobKey);
  }
}
