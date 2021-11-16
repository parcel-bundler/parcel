// @flow strict-local
import type {Readable} from 'stream';
import type {FilePath} from '@parcel/types';
import type {Cache} from './types';

import path from 'path';
import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
import {NodeFS} from '@parcel/fs';
import {blobToStream, bufferStream} from '@parcel/utils';
import invariant from 'assert';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';
// $FlowFixMe
import lmdb from 'lmdb-store';

export class LMDBCache implements Cache {
  fs: NodeFS;
  dir: FilePath;
  // $FlowFixMe
  store: any;

  constructor(cacheDir: FilePath) {
    this.fs = new NodeFS();
    this.dir = cacheDir;

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
    return blobToStream(this.store.get(key));
  }

  async setStream(key: string, stream: Readable): Promise<void> {
    let buf = await bufferStream(stream);
    await this.store.put(key, buf);
  }

  getBlob(key: string): Promise<Buffer> {
    let buffer = this.store.get(key);
    return buffer != null
      ? Promise.resolve(buffer)
      : Promise.reject(new Error(`Key ${key} not found in cache`));
  }

  async setBlob(key: string, contents: Buffer | string): Promise<void> {
    invariant(
      !isLargeBlob(contents),
      'Cannot store large blobs in the cache. You may want to use `setLargeBlob` instead.',
    );
    await this.store.put(key, contents);
  }

  getBuffer(key: string): Promise<?Buffer> {
    return Promise.resolve(this.store.get(key));
  }

  hasLargeBlob(key: string): Promise<boolean> {
    return this.fs.exists(path.join(this.dir, key));
  }

  getLargeBlob(key: string): Promise<Buffer> {
    return this.fs.readFile(path.join(this.dir, key));
  }

  async setLargeBlob(key: string, contents: Buffer | string): Promise<void> {
    await this.fs.writeFile(path.join(this.dir, key), contents);
  }
}

// lmbd-store decodes cached binary data into a Node Buffer
// via `Nan::NewBuffer`, which enforces a max size of ~1GB.
// We subtract 9 bytes to account for any compression heaader
// added by lmbd-store when encoding the data.
// See: https://github.com/nodejs/nan/issues/883
const MAX_BUFFER_SIZE = 0x3fffffff - 9;

function isLargeBlob(contents: Buffer | string): boolean {
  return typeof contents === 'string'
    ? Buffer.byteLength(contents) > MAX_BUFFER_SIZE
    : contents.length > MAX_BUFFER_SIZE;
}

registerSerializableClass(`${packageJson.version}:LMDBCache`, LMDBCache);
