// @flow strict-local

import type {Readable} from 'stream';
import type {FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

import path from 'path';
import logger from '@parcel/logger';
import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';

export default class Cache {
  fs: FileSystem;
  dir: FilePath;

  constructor(fs: FileSystem, cacheDir: FilePath) {
    this.fs = fs;
    this.dir = cacheDir;
  }

  _getCachePath(cacheId: string, extension: string = '.v8'): FilePath {
    return path.join(
      this.dir,
      cacheId.slice(0, 2),
      cacheId.slice(2) + extension,
    );
  }

  getStream(key: string): Readable {
    return this.fs.createReadStream(this._getCachePath(key, '.blob'));
  }

  setStream(key: string, stream: Readable): Promise<string> {
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

  getBlob(key: string): Promise<Buffer> {
    return this.fs.readFile(this._getCachePath(key, '.blob'));
  }

  async setBlob(key: string, contents: Buffer | string): Promise<string> {
    await this.fs.writeFile(this._getCachePath(key, '.blob'), contents);
    return key;
  }

  async get<T>(key: string): Promise<?T> {
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

  async set(key: string, value: mixed): Promise<?string> {
    try {
      let blobPath = this._getCachePath(key);
      let data = serialize(value);

      await this.fs.writeFile(blobPath, data);
      return key;
    } catch (err) {
      logger.error(err, '@parcel/cache');
    }
  }
}

export async function createCacheDir(
  fs: FileSystem,
  dir: FilePath,
): Promise<void> {
  // First, create the main cache directory if necessary.
  await fs.mkdirp(dir);

  // In parallel, create sub-directories for every possible hex value
  // This speeds up large caches on many file systems since there are fewer files in a single directory.
  let dirPromises = [];
  for (let i = 0; i < 256; i++) {
    dirPromises.push(
      fs.mkdirp(path.join(dir, ('00' + i.toString(16)).slice(-2))),
    );
  }

  await Promise.all(dirPromises);
}

registerSerializableClass(`${packageJson.version}:Cache`, Cache);
