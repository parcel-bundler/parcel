// @flow strict-local
import type {Readable} from 'stream';
import type {FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {Cache} from './types';

import path from 'path';
import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
import {blobToStream, bufferStream} from '@parcel/utils';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';
// $FlowFixMe
import lmdb from 'lmdb-store';

export class LMDBCache implements Cache {
  fs: FileSystem;
  dir: FilePath;
  // $FlowFixMe
  store: any;

  constructor(fs: FileSystem, cacheDir: FilePath) {
    this.fs = fs;
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

  serialize(): {|fs: FileSystem, dir: FilePath|} {
    return {
      fs: this.fs,
      dir: this.dir,
    };
  }

  static deserialize(opts: {|fs: FileSystem, dir: FilePath|}): LMDBCache {
    return new LMDBCache(opts.fs, opts.dir);
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
    await this.store.put(key, serialize(value));
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

registerSerializableClass(`${packageJson.version}:LMDBCache`, LMDBCache);
