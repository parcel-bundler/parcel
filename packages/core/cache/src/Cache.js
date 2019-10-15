// @flow strict-local

import type {Readable} from 'stream';

import type {FilePath} from '@parcel/types';

import type {FileSystem} from '@parcel/fs';
import path from 'path';
import logger from '@parcel/logger';
import {
  serialize,
  deserialize,
  prepareForSerialization,
  restoreDeserializedObject,
  registerSerializableClass,
  bufferStream,
  blobToStream
} from '@parcel/utils';
// $FlowFixMe this is untyped
import packageJson from '../package.json';
import sharedObject from 'shared-object';

export default class Cache {
  fs: FileSystem;
  dir: FilePath;

  constructor(fs: FileSystem, cacheDir: FilePath, obj) {
    this.fs = fs;
    this.dir = cacheDir;
    this.obj = obj || sharedObject.create({});
  }

  static deserialize(opts) {
    return new Cache(opts.fs, opts.dir, sharedObject.get(opts.handle));
  }

  serialize() {
    return {
      $$raw: false,
      fs: this.fs,
      dir: this.dir,
      handle: sharedObject.getHandle(this.obj)
    };
  }

  _getCachePath(cacheId: string, extension: string = '.v8'): FilePath {
    return path.join(
      this.dir,
      cacheId.slice(0, 2),
      cacheId.slice(2) + extension
    );
  }

  getStream(key: string): Readable {
    // let buffer = Buffer.from(this.obj[key], 'base64');
    // return blobToStream(buffer);
    return this.fs.createReadStream(this._getCachePath(key, '.blob'));
  }

  async setStream(key: string, stream: Readable): Promise<string> {
    // let buffer = await bufferStream(stream);
    // this.obj[key] = buffer.toString('base64');
    // return key;
    return new Promise((resolve, reject) => {
      stream
        .pipe(this.fs.createWriteStream(this._getCachePath(key, '.blob')))
        .on('error', reject)
        .on('finish', () => resolve(key));
    });
  }

  blobExists(key: string): Promise<boolean> {
    return this.fs.exists(this._getCachePath(key, '.blob'));
  }

  getBlob(key: string, encoding?: buffer$Encoding) {
    return this.fs.readFile(this._getCachePath(key, '.blob'), encoding);
  }

  async setBlob(key: string, contents: Buffer | string) {
    await this.fs.writeFile(this._getCachePath(key, '.blob'), contents);
    return key;
  }

  async get(key: string) {
    // if (key in this.obj) {
    // console.log("EXISTS", this.obj)
    // return restoreDeserializedObject(this.obj[key]);
    // }

    try {
      let data = await this.fs.readFile(this._getCachePath(key));
      return deserialize(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      } else {
        throw err;
      }
    }
  }

  async set(key: string, value: mixed) {
    // this.obj[key] = prepareForSerialization(value);

    try {
      let blobPath = this._getCachePath(key);
      let data = serialize(value);

      await this.fs.writeFile(blobPath, data);
      return key;
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }
}

export async function createCacheDir(
  fs: FileSystem,
  dir: FilePath
): Promise<void> {
  // First, create the main cache directory if necessary.
  await fs.mkdirp(dir);

  // In parallel, create sub-directories for every possible hex value
  // This speeds up large caches on many file systems since there are fewer files in a single directory.
  let dirPromises = [];
  for (let i = 0; i < 256; i++) {
    dirPromises.push(
      fs.mkdirp(path.join(dir, ('00' + i.toString(16)).slice(-2)))
    );
  }

  await Promise.all(dirPromises);
}

registerSerializableClass(`${packageJson.version}:Cache`, Cache);
