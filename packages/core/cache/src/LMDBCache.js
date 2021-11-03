// @flow strict-local
import type {Readable} from 'stream';
import type {FilePath} from '@parcel/types';
import type {Cache} from './types';

import path from 'path';
import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
import {NodeFS} from '@parcel/fs';
import {blobToStream, bufferStream} from '@parcel/utils';
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
    if (this.store.get(key) != null) return Promise.resolve(true);
    return this.hasLargeBlob(key);
  }

  async get<T>(key: string): Promise<?T> {
    let data = await this.getBuffer(key);
    return data == null ? null : deserialize(data);
  }

  async set(key: string, value: mixed): Promise<void> {
    await this.setBlob(key, serialize(value));
  }

  getStream(key: string): Readable {
    return blobToStream(
      this.store.get(key) ?? this.fs.readFileSync(path.join(this.dir, key)),
    );
  }

  async setStream(key: string, stream: Readable): Promise<void> {
    await this.setBlob(key, await bufferStream(stream));
  }

  async getBlob(key: string): Promise<Buffer> {
    let buffer = await this.getBuffer(key);
    if (buffer == null) throw new Error(`Key ${key} not found in cache`);
    return buffer;
  }

  async setBlob(key: string, contents: Buffer | string): Promise<void> {
    if (isLargeBlob(contents)) {
      // Remove the old blob if it has been 'upgraded' to large blob storage.
      if (this.store.get(key) != null) await this.store.remove(key);
      await this.setLargeBlob(key, contents);
    } else {
      await this.store.put(key, contents);
    }
  }

  async getBuffer(key: string): Promise<?Buffer> {
    let buffer = this.store.get(key);
    if (buffer == null && (await this.hasLargeBlob(key))) {
      buffer = await this.getLargeBlob(key);
    }
    return buffer;
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
