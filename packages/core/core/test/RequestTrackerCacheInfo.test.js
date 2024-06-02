// @flow strict-local

import type {Cache} from '@parcel/types';
import {FSCache, LMDBCache} from '@parcel/cache';
import * as tempy from 'tempy';
import {
  clearRequestTrackerCacheInfo,
  getRequestTrackerCacheInfo,
  storeRequestTrackerCacheInfo,
} from '../src/RequestTrackerCacheInfo';
import assert from 'assert';
import {NodeFS} from '@parcel/fs';

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
          requestGraphKey: 'request-graph-key',
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
          requestGraphKey: 'request-graph-key',
        };
        await storeRequestTrackerCacheInfo(cache, expectedEntry);
        await clearRequestTrackerCacheInfo(cache);
        const entry = await getRequestTrackerCacheInfo(cache);
        assert(entry === null);
      });
    });
  });
});
