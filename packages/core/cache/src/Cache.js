// @flow strict-local

import type {Readable} from 'stream';

import type {FilePath} from '@parcel/types';

import * as fs from '@parcel/fs';
import {createReadStream, createWriteStream} from 'fs';
import invariant from 'assert';
import path from 'path';
import logger from '@parcel/logger';
import {serialize, deserialize, registerSerializableClass} from '@parcel/utils';
// $FlowFixMe this is untyped
import packageJson from '../package.json';

export default class Cache {
  dir: FilePath;

  constructor(cacheDir: FilePath) {
    this.dir = cacheDir;
  }

  static deserialize(opts: {cacheDir: FilePath}) {
    return new Cache(opts.cacheDir);
  }

  serialize() {
    return {
      cacheDir: this.dir
    };
  }

  _getCachePath(cacheId: string, extension: string = '.json'): FilePath {
    return path.join(
      this.dir,
      cacheId.slice(0, 2),
      cacheId.slice(2) + extension
    );
  }

  getStream(key: string): Readable {
    return createReadStream(this._getCachePath(key, '.blob'));
  }

  async setStream(key: string, stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      stream
        .pipe(createWriteStream(this._getCachePath(key, '.blob')))
        .on('error', reject)
        .on('finish', () => resolve(key));
    });
  }

  async get(key: string) {
    try {
      let data = await fs.readFile(this._getCachePath(key), {encoding: 'utf8'});

      invariant(typeof data === 'string');
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
    try {
      let blobPath = this._getCachePath(key);
      let data = serialize(value);

      await fs.writeFile(blobPath, data);
      return key;
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }
}

// Cache for whether a cache dir exists
const existsCache: Set<FilePath> = new Set();

export async function createCacheDir(dir: FilePath): Promise<void> {
  if (existsCache.has(dir)) {
    return;
  }

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

  await dirPromises;
  existsCache.add(dir);
}

registerSerializableClass(`${packageJson.version}:Cache`, Cache);
