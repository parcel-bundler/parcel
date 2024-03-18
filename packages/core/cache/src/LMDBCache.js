// @flow strict-local
import type {FilePath} from '@parcel/types';
import type {Cache} from './types';
import type {Readable, Writable} from 'stream';

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import stream from 'stream';
import path from 'path';
import {promisify} from 'util';
import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
import {NodeFS} from '@parcel/fs';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';
// $FlowFixMe
import lmdb from 'lmdb';

import {FSCache} from './FSCache';

const pipeline: (Readable, Writable) => Promise<void> = promisify(
  stream.pipeline,
);

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

  hasLargeBlob(key: string): Promise<boolean> {
    return this.fs.exists(this.#getFilePath(key, 0));
  }

  // eslint-disable-next-line require-await
  async getLargeBlob(key: string): Promise<Buffer> {
    return this.fsCache.getLargeBlob(key);
  }

  // eslint-disable-next-line require-await
  async setLargeBlob(
    key: string,
    contents: Buffer | string,
    options?: {|signal?: AbortSignal|},
  ): Promise<void> {
    return this.fsCache.setLargeBlob(key, contents, options);
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
