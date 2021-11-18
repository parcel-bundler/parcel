// @flow strict-local
import type {FilePath} from '@parcel/types';
import type {Cache} from './types';

import {Readable} from 'stream';
import path from 'path';
import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
import {bufferStream} from '@parcel/utils';
import {NodeFS} from '@parcel/fs';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';
// $FlowFixMe
import lmdb from 'lmdb-store';

const STREAM = '@@stream';
const LARGE_BLOB = '@@large_blob';
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

  async get<T>(key: string): Promise<?T> {
    let data = this.store.get(key);
    if (data === LARGE_BLOB) {
      data = await this.fs.readFile(path.join(this.dir, key));
    } else if (data === STREAM) {
      data = await bufferStream(this.store.getStream(key));
    }
    if (data == null) {
      return null;
    }
    return deserialize(data);
  }

  set(key: string, value: mixed): Promise<void> {
    return this.setBlob(key, serialize(value));
  }

  getStream(key: string): Readable {
    let filename = path.join(this.dir, key);
    if (this.fs.existsSync(filename)) {
      return this.fs.createReadStream(filename);
    } else {
      // If the file doesn't exists, return an empty stream.
      let stream = new Readable();
      stream.push(null);
      return stream;
    }
  }

  setStream(key: string, stream: Readable): Promise<void> {
    return new Promise((resolve, reject) => {
      stream
        .pipe(this.fs.createWriteStream(path.join(this.dir, key)))
        .on('error', reject)
        .on('finish', () => resolve(this.store.put(key, STREAM)));
    });
  }

  getBlob(key: string): Promise<Buffer> {
    let data = this.store.get(key);
    if (data == null) {
      return Promise.reject(new Error(`Key ${key} not found in cache`));
    } else if (data === LARGE_BLOB) {
      return this.fs.readFile(path.join(this.dir, key));
    } else if (data === STREAM) {
      return bufferStream(this.getStream(key));
    }
    return Promise.resolve(data);
  }

  async setBlob(key: string, contents: Buffer | string): Promise<void> {
    if (isLargeBlob(contents)) {
      await this.fs.writeFile(path.join(this.dir, key), contents);
      await this.store.put(key, LARGE_BLOB);
    } else {
      await this.store.put(key, contents);
    }
  }

  getBuffer(key: string): Promise<?Buffer> {
    let data = this.store.get(key);
    if (data === LARGE_BLOB) {
      return this.fs.readFile(path.join(this.dir, key));
    } else if (data === STREAM) {
      return bufferStream(this.getStream(key));
    }
    return Promise.resolve(data);
  }
}

registerSerializableClass(`${packageJson.version}:LMDBCache`, LMDBCache);
