// @flow strict-local

import type {Cache} from '@parcel/types';
import {FSCache, LMDBCache} from '@parcel/cache';
import * as tempy from 'tempy';
import {
  clearRequestTrackerCache,
  clearRequestTrackerCacheInfo,
  getRequestTrackerCacheInfo,
  storeRequestTrackerCacheInfo,
  toFsCacheKey,
} from '../src/RequestTrackerCacheInfo';
import assert from 'assert';
import {NodeFS} from '@parcel/fs';
import type {RequestTrackerCacheInfo} from '../src/RequestTrackerCacheInfo';

type CacheImplementation = {|
  name: string,
  build: () => Cache,
|};

const cacheImplementations: CacheImplementation[] = [
  {
    name: 'FSCache',
    build: () => new FSCache(new NodeFS(), tempy.directory()),
  },
  {
    name: 'LMDBCache',
    build: () => new LMDBCache(tempy.directory()),
  },
];

describe('RequestTrackerCacheInfo', () => {
  cacheImplementations.forEach(cacheImplementation => {
    describe(`When using ${cacheImplementation.name}`, () => {
      let cache: Cache;
      const requestGraphKey = toFsCacheKey('request-graph-key');

      beforeEach(async () => {
        cache = cacheImplementation.build();
        await cache.ensure();
      });

      it('getRequestTrackerCacheInfo - returns null if the cache entry is missing', async () => {
        const entry = await getRequestTrackerCacheInfo(cache);
        assert(entry === null);
      });

      it("getRequestTrackerCacheInfo - returns an entry if it's set with the store method", async () => {
        {
          const entry = await getRequestTrackerCacheInfo(cache);
          assert(entry === null);
        }
        const expectedEntry = {
          snapshotKey: 'snapshot-key',
          timestamp: Date.now(),
          requestGraphKey: requestGraphKey,
        };
        await storeRequestTrackerCacheInfo(cache, expectedEntry);
        {
          const entry = await getRequestTrackerCacheInfo(cache);
          assert.deepEqual(entry, expectedEntry);
        }
      });

      it('entries can be cleared with clearRequestTrackerCacheInfo', async () => {
        const expectedEntry = {
          snapshotKey: 'snapshot-key',
          timestamp: Date.now(),
          requestGraphKey: requestGraphKey,
          allLargeBlobKeys: [],
        };
        await storeRequestTrackerCacheInfo(cache, expectedEntry);
        await clearRequestTrackerCacheInfo(cache);
        const entry = await getRequestTrackerCacheInfo(cache);
        assert(entry === null);
      });

      it('request-graph and large blob entries are cleared', async () => {
        const otherKey = toFsCacheKey('other-key');

        await cache.setLargeBlob(requestGraphKey, '1234');
        await cache.setLargeBlob(otherKey, '5678');
        assert.equal(await cache.getLargeBlob(requestGraphKey), '1234');
        assert.equal(await cache.getLargeBlob(otherKey), '5678');

        const expectedEntry: RequestTrackerCacheInfo = {
          snapshotKey: 'snapshot-key',
          timestamp: Date.now(),
          requestGraphKey: requestGraphKey,
          allLargeBlobKeys: [otherKey],
        };
        await storeRequestTrackerCacheInfo(cache, expectedEntry);
        await clearRequestTrackerCache(cache);
        const entry = await getRequestTrackerCacheInfo(cache);

        assert(entry === null);
        assert.equal(await cache.hasLargeBlob(requestGraphKey), false);
        assert.equal(await cache.hasLargeBlob(otherKey), false);
      });
    });
  });
});
