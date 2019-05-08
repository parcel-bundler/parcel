// @flow

import type {Readable} from 'stream';

import type {FilePath, ParcelOptions, JSONObject} from '@parcel/types';

import * as fs from '@parcel/fs';
import {createReadStream, createWriteStream} from 'fs';
import invariant from 'assert';
import path from 'path';
import logger from '@parcel/logger';
import {objectHash, serialize, deserialize} from '@parcel/utils';
import pkg from '../package.json';

// These keys can affect the output, so if they differ, the cache should not match
// const OPTION_KEYS = ['publicURL', 'minify', 'hmr', 'target', 'scopeHoist'];
const OPTION_KEYS = [];

// Cache for whether a cache dir exists
const existsCache = new Set();

export class Cache {
  dir: FilePath;
  invalidated: Set<FilePath>;
  optionsHash: string;

  init(options: ParcelOptions) {
    this.dir = path.resolve(options.cacheDir);
    this.invalidated = new Set();
    this.optionsHash = objectHash(
      OPTION_KEYS.reduce((p: JSONObject, k) => ((p[k] = options[k]), p), {
        version: pkg.version
      })
    );
  }

  async createCacheDir(dir: FilePath): Promise<void> {
    dir = path.resolve(dir);
    if (existsCache.has(dir)) {
      return;
    }

    // Create sub-directories for every possible hex value
    // This speeds up large caches on many file systems since there are fewer files in a single directory.
    for (let i = 0; i < 256; i++) {
      await fs.mkdirp(path.join(dir, ('00' + i.toString(16)).slice(-2)));
    }

    existsCache.add(dir);
  }

  getCachePath(cacheId: string, extension: string = '.json'): FilePath {
    return path.join(
      this.dir,
      cacheId.slice(0, 2),
      cacheId.slice(2) + extension
    );
  }

  getStream(key: string): Readable {
    return createReadStream(this.getCachePath(key, '.blob'));
  }

  async setStream(key: string, stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      stream
        .pipe(createWriteStream(this.getCachePath(key, '.blob')))
        .on('error', reject)
        .on('finish', () => resolve(key));
    });
  }

  async get(key: string) {
    try {
      // let extension = path.extname(key);
      // TODO: support more extensions
      let data = await fs.readFile(this.getCachePath(key), {encoding: 'utf8'});

      // if (extension === '.json') {
      invariant(typeof data === 'string');
      return deserialize(data);
      //}

      //return data;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      } else {
        throw err;
      }
    }
  }

  async set(key: string, value: any) {
    try {
      // TODO: support more than just JSON
      let blobPath = this.getCachePath(key);
      let data = serialize(value);

      await fs.writeFile(blobPath, data);
      return key;
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }
}

export default new Cache();
