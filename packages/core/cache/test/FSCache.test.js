// @flow

import * as mkdirp from 'mkdirp';
import * as fs from 'fs';
import * as tempy from 'tempy';
import assert from 'assert';
import path from 'path';
import {NodeFS} from '@parcel/fs';
import {type Cache, FSCache} from '../src';

/**
 * Cache keys that aren't HEX strings will silently fail to write
 * using FSCache, unless they are large blob entries.
 */
function toHex(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    result += s.charCodeAt(i).toString(16);
  }
  return result;
}

describe('FSCache', () => {
  let fsCache: Cache;
  const makeFSCache = async (writeLimitChunk?: number) => {
    const fs = new NodeFS();
    const tmpDir = path.join(tempy.directory(), 'FSCache');
    mkdirp.sync(tmpDir);
    fsCache = new FSCache(fs, tmpDir, writeLimitChunk);
    await fsCache.ensure();
    return {fsCache, fs, tmpDir};
  };
  beforeEach(async () => {
    fsCache = (await makeFSCache()).fsCache;
  });

  it('FSCache::get / set will return key values', async () => {
    assert(!(await fsCache.has(toHex('test-key'))), 'FS did not start empty');

    await fsCache.set(toHex('test-key'), 'value');
    const value = await fsCache.get(toHex('test-key'));
    assert(value === 'value', 'FS did not store value');
    assert(await fsCache.has(toHex('test-key')), 'FS did set key');
  });

  it('FSCache::getBlob / setBlob will return buffers', async () => {
    assert(!(await fsCache.has(toHex('test-key'))), 'FS did not start empty');

    const buffer = Buffer.from([1, 2, 3, 4]);
    await fsCache.setBlob(toHex('test-key'), buffer);
    const value: Buffer = await fsCache.getBlob(toHex('test-key'));
    assert(await fsCache.has(toHex('test-key')), 'FS did set key');
    assert(Buffer.isBuffer(value), 'FS did not store a buffer');
    assert(
      value.equals(Buffer.from([1, 2, 3, 4])),
      'FS did not store a buffer',
    );
  });

  it('can set large blobs', async () => {
    assert(!(await fsCache.has(toHex('test-key'))), 'FS did not start empty');
    assert(
      !(await fsCache.hasLargeBlob(toHex('test-key'))),
      'FS did not start empty',
    );

    const buffer = Buffer.from([1, 2, 3, 4]);
    await fsCache.setLargeBlob(toHex('test-key'), buffer);
    assert(
      !(await fsCache.has(toHex('test-key'))),
      'FS set key for large blob',
    );
    assert(
      await fsCache.hasLargeBlob(toHex('test-key')),
      'FS did not set large blob',
    );
    const value: Buffer = await fsCache.getLargeBlob(toHex('test-key'));
    assert(Buffer.isBuffer(value), 'FS did not store a buffer');
    assert(
      value.equals(Buffer.from([1, 2, 3, 4])),
      'FS did not store a buffer',
    );
  });

  it('can set large blobs if they are above the write limit', async () => {
    const {fsCache, tmpDir} = await makeFSCache(10);
    assert(!(await fsCache.has(toHex('test-key'))), 'FS did not start empty');
    assert(
      !(await fsCache.hasLargeBlob(toHex('test-key'))),
      'FS did not start empty',
    );
    const range = n => new Array(n).map((_, i) => i);

    const buffer = Buffer.from(range(500));
    assert(buffer.length === 500);

    await fsCache.setLargeBlob(toHex('test-key'), buffer);
    assert(
      !(await fsCache.has(toHex('test-key'))),
      'FS set key for large blob',
    );
    assert(
      await fsCache.hasLargeBlob(toHex('test-key')),
      'FS did not set large blob',
    );
    const value: Buffer = await fsCache.getLargeBlob(toHex('test-key'));
    assert(Buffer.isBuffer(value), 'FS did not store a buffer');
    assert(value.equals(Buffer.from(range(500))), 'FS did not store a buffer');

    // testing implementation details
    const cacheKey = toHex('test-key');
    const entries = fs
      .readdirSync(path.join(tmpDir))
      .filter(entry => entry.startsWith(cacheKey));
    assert(
      entries.length === 50,
      `Entries were not broken-up onto multiple files (expected=10 got=${entries.length})`,
    );
  });
});
