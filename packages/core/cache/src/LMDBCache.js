// @flow strict-local
import crypto from 'crypto';
import type {FilePath} from '@parcel/types';
import type {Cache} from './types';
import type {Readable, Writable} from 'stream';

import stream from 'stream';
import path from 'path';
import {promisify} from 'util';
import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
import {getFeatureFlag} from '@parcel/feature-flags';
import {NodeFS} from '@parcel/fs';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';
import lmdb from 'lmdb';

import {FSCache} from './FSCache';

const pipeline: (Readable, Writable) => Promise<void> = promisify(
  stream.pipeline,
);

/**
 * See `LMDBCache::setLargeBlob`
 */
type LargeBlobEntry = {|type: 'LARGE_BLOB', largeBlobKey: string|};

export class LMDBCache implements Cache {
  fs: NodeFS;
  dir: FilePath;
  // $FlowFixMe
  store: any;
  fsCache: FSCache;

  constructor(cacheDir: FilePath) {
    this.fs = new NodeFS();
    this.dir = cacheDir;
    this.fsCache = new FSCache(this.fs, cacheDir);

    this.store = lmdb.open(cacheDir, {
      name: 'parcel-cache',
      encoding: 'binary',
      compression: true,
    });
  }

  ensure(): Promise<void> {
    return Promise.resolve();
  }

  serialize(): {|dir: FilePath|} {
    return {
      dir: this.dir,
    };
  }

  static deserialize(opts: {|dir: FilePath|}): LMDBCache {
    return new LMDBCache(opts.dir);
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.store.get(key) != null);
  }

  get<T>(key: string): Promise<?T> {
    let data = this.store.get(key);
    if (data == null) {
      return Promise.resolve(null);
    }

    return Promise.resolve(deserialize(data));
  }

  async set(key: string, value: mixed): Promise<void> {
    await this.setBlob(key, serialize(value));
  }

  getStream(key: string): Readable {
    return this.fs.createReadStream(path.join(this.dir, key));
  }

  setStream(key: string, stream: Readable): Promise<void> {
    return pipeline(
      stream,
      this.fs.createWriteStream(path.join(this.dir, key)),
    );
  }

  getBlob(key: string): Promise<Buffer> {
    let buffer = this.store.get(key);
    return buffer != null
      ? Promise.resolve(buffer)
      : Promise.reject(new Error(`Key ${key} not found in cache`));
  }

  async setBlob(key: string, contents: Buffer | string): Promise<void> {
    await this.store.put(key, contents);
  }

  getBuffer(key: string): Promise<?Buffer> {
    return Promise.resolve(this.store.get(key));
  }

  #getFilePath(key: string, index: number): string {
    return path.join(this.dir, `${key}-${index}`);
  }

  async hasLargeBlob(key: string): Promise<boolean> {
    if (!(await this.has(key))) {
      return false;
    }
    const entry = await this.get<LargeBlobEntry>(key);
    if (entry?.type !== 'LARGE_BLOB') {
      return false;
    }
    return this.fsCache.hasLargeBlob(entry.largeBlobKey);
  }

  async getLargeBlob(key: string): Promise<Buffer> {
    if (!(await this.has(key))) {
      throw new Error(`No large blob entry found for key=${key}`);
    }
    const entry = await this.get<LargeBlobEntry>(key);
    if (entry?.type !== 'LARGE_BLOB') {
      throw new Error(`Invalid entry at large blob key=${key}`);
    }
    return this.fsCache.getLargeBlob(entry.largeBlobKey);
  }

  /**
   * Set large blob into LMDB.
   * This stores large blobs as files on a delegate FSCache,
   * but uses an LMDB entry to provide transactional behaviour.
   *
   * On its own the FSCache implementation is not transactional and
   * may result in corrupted caches. Furthermore, it may result in
   * partially written or read caches, where we are concatenating bytes
   * from different cache writes.
   */
  async setLargeBlob(
    key: string,
    contents: Buffer | string,
    options?: {|signal?: AbortSignal|},
  ): Promise<void> {
    const previousEntry = await this.get<LargeBlobEntry>(key);
    if (previousEntry) {
      await this.store.remove(key);
      await this.fsCache.deleteLargeBlob(previousEntry.largeBlobKey);
    }

    // $FlowFixMe flow libs are outdated but we only support node>16 so randomUUID is present
    const largeBlobKey = getFeatureFlag('randomLargeBlobKeys')
      ? `${key}_${crypto.randomUUID()}`
      : key;
    await this.fsCache.setLargeBlob(largeBlobKey, contents, options);
    const entry: LargeBlobEntry = {type: 'LARGE_BLOB', largeBlobKey};
    await this.set(key, entry);
  }

  async deleteLargeBlob(key: string): Promise<void> {
    if (!(await this.has(key))) {
      return;
    }
    const entry = await this.get<LargeBlobEntry>(key);
    if (entry?.type !== 'LARGE_BLOB') {
      return;
    }
    await this.store.remove(key);
    return this.fsCache.deleteLargeBlob(entry.largeBlobKey);
  }

  refresh(): void {
    // Reset the read transaction for the store. This guarantees that
    // the next read will see the latest changes to the store.
    // Useful in scenarios where reads and writes are multi-threaded.
    // See https://github.com/kriszyp/lmdb-js#resetreadtxn-void
    this.store.resetReadTxn();
  }
}

registerSerializableClass(`${packageJson.version}:LMDBCache`, LMDBCache);
