// @flow

import {DEFAULT_FEATURE_FLAGS, setFeatureFlags} from '@parcel/feature-flags';
import * as mkdirp from 'mkdirp';
import * as tempy from 'tempy';
import fs from 'fs';
import assert from 'assert';
import path from 'path';
import {LMDBCache, type Cache} from '../src';

describe('LMDBCache', () => {
  let tmpDir: string;
  let lmdbCache: Cache;
  beforeEach(async () => {
    tmpDir = path.join(tempy.directory(), 'LMDBCache');
    mkdirp.sync(tmpDir);
    lmdbCache = new LMDBCache(tmpDir);
    await lmdbCache.ensure();

    setFeatureFlags({
      ...DEFAULT_FEATURE_FLAGS,
      randomLargeBlobKeys: true,
    });
  });

  afterEach(() => {
    setFeatureFlags({
      ...DEFAULT_FEATURE_FLAGS,
    });
  });

  it('LMDBCache::get / set will return key values', async () => {
    assert(!(await lmdbCache.has('test-key')), 'LMDB did not start empty');

    await lmdbCache.set('test-key', 'value');
    const value = await lmdbCache.get('test-key');
    assert(await lmdbCache.has('test-key'), 'LMDB did set key');
    assert(value === 'value', 'LMDB did not store value');
  });

  it('LMDBCache::getBlob / setBlob will return buffers', async () => {
    assert(!(await lmdbCache.has('test-key')), 'LMDB did not start empty');

    const buffer = Buffer.from([1, 2, 3, 4]);
    await lmdbCache.setBlob('test-key', buffer);
    const value: Buffer = await lmdbCache.getBlob('test-key');
    assert(await lmdbCache.has('test-key'), 'LMDB did set key');
    assert(Buffer.isBuffer(value), 'LMDB did not store a buffer');
    assert(
      value.equals(Buffer.from([1, 2, 3, 4])),
      'LMDB did not store a buffer',
    );
  });

  it('can set large blobs', async () => {
    assert(!(await lmdbCache.has('test-key')), 'LMDB did not start empty');
    assert(
      !(await lmdbCache.hasLargeBlob('test-key')),
      'LMDB did not start empty',
    );

    const buffer = Buffer.from([1, 2, 3, 4]);
    await lmdbCache.setLargeBlob('test-key', buffer);
    assert(
      await lmdbCache.hasLargeBlob('test-key'),
      'LMDB did not set large blob',
    );
    const value: Buffer = await lmdbCache.getLargeBlob('test-key');
    assert(Buffer.isBuffer(value), 'LMDB did not store a buffer');
    assert(
      value.equals(Buffer.from([1, 2, 3, 4])),
      'LMDB did not store a buffer',
    );
  });

  it('setting multiple large blobs and then removing them will leave the disk empty', async () => {
    assert(!(await lmdbCache.has('test-key')), 'LMDB did not start empty');

    const filesAtStart = fs.readdirSync(tmpDir);

    const buffer = Buffer.from([1, 2, 3, 4]);
    await lmdbCache.setLargeBlob('test-key', buffer);
    await lmdbCache.setLargeBlob('test-key', buffer);
    await lmdbCache.setLargeBlob('test-key', buffer);
    await lmdbCache.setLargeBlob('other-key', buffer);
    await lmdbCache.setLargeBlob('other-key', buffer);
    await lmdbCache.setLargeBlob('other-key', buffer);
    await lmdbCache.deleteLargeBlob('test-key');
    await lmdbCache.deleteLargeBlob('other-key');

    const filesAtEnd = fs.readdirSync(tmpDir);
    assert.deepEqual(filesAtStart, filesAtEnd);
  });
});
