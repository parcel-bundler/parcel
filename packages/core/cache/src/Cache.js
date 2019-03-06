// @flow
import * as fs from '@parcel/fs';
import pkg from '../package.json';
import Path from 'path';
import {md5FromString} from '@parcel/utils/src/md5';
import objectHash from '@parcel/utils/lib/objectHash';
import logger from '@parcel/logger';
import type {
  FilePath,
  CLIOptions,
  JSONObject,
  CacheEntry,
  Asset,
  Environment
} from '@parcel/types';
import {serialize, deserialize} from '@parcel/utils/serializer';

// These keys can affect the output, so if they differ, the cache should not match
// const OPTION_KEYS = ['publicURL', 'minify', 'hmr', 'target', 'scopeHoist'];
const OPTION_KEYS = [];

// Default cache directory name
const DEFAULT_CACHE_DIR = '.parcel-cache';

// Cache for whether a cache dir exists
const existsCache = new Set();

export class Cache {
  dir: FilePath;
  invalidated: Set<FilePath>;
  optionsHash: string;

  init(options: CLIOptions) {
    this.dir = Path.resolve(options.cacheDir || DEFAULT_CACHE_DIR);
    this.invalidated = new Set();
    this.optionsHash = objectHash(
      OPTION_KEYS.reduce((p: JSONObject, k) => ((p[k] = options[k]), p), {
        version: pkg.version
      })
    );
  }

  async createCacheDir(dir: FilePath = DEFAULT_CACHE_DIR) {
    dir = Path.resolve(dir);
    if (existsCache.has(dir)) {
      return;
    }

    // Create sub-directories for every possible hex value
    // This speeds up large caches on many file systems since there are fewer files in a single directory.
    for (let i = 0; i < 256; i++) {
      await fs.mkdirp(Path.join(dir, ('00' + i.toString(16)).slice(-2)));
    }

    existsCache.add(dir);
  }

  getCacheId(appendedData: string, env: Environment) {
    return md5FromString(this.optionsHash + appendedData + JSON.stringify(env));
  }

  getCachePath(cacheId: string, extension: string = '.json'): FilePath {
    return Path.join(
      this.dir,
      cacheId.slice(0, 2),
      cacheId.slice(2) + extension
    );
  }

  async writeBlob(type: string, cacheId: string, data: any) {
    let blobPath = this.getCachePath(cacheId, '.' + type);
    if (typeof data === 'object') {
      if (Buffer.isBuffer(data)) {
        blobPath += '.bin';
      } else {
        data = serialize(data);
        if (type !== 'json') {
          blobPath += '.json';
        }
      }
    }

    await fs.writeFile(blobPath, data);
    return new CacheReference(Path.relative(this.dir, blobPath));
  }

  async _writeBlobs(assets: Array<Asset>) {
    return await Promise.all(
      assets.map(async asset => {
        let assetCacheId = this.getCacheId(asset.id, asset.env);
        for (let blobKey in asset.output) {
          asset.output[blobKey] = await this.writeBlob(
            blobKey,
            assetCacheId,
            asset.output[blobKey]
          );
        }

        return asset;
      })
    );
  }

  async writeBlobs(cacheEntry: CacheEntry) {
    cacheEntry.assets = await this._writeBlobs(cacheEntry.assets);
    if (cacheEntry.initialAssets) {
      cacheEntry.initialAssets = await this._writeBlobs(
        cacheEntry.initialAssets
      );
    }

    return cacheEntry;
  }

  async write(cacheEntry: CacheEntry) {
    try {
      let cacheId = this.getCacheId(cacheEntry.filePath, cacheEntry.env);
      await this.writeBlobs(cacheEntry);
      await this.writeBlob('json', cacheId, cacheEntry);
      this.invalidated.delete(cacheEntry.filePath);
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }

  async readBlob(blobKey: FilePath) {
    let extension = Path.extname(blobKey);
    let data = await fs.readFile(Path.resolve(this.dir, blobKey), {
      encoding: extension === '.bin' ? undefined : 'utf8'
    });

    if (extension === '.json') {
      data = deserialize(data);
    }

    return data;
  }

  async readBlobs(asset: Asset) {
    await Promise.all(
      Object.keys(asset.output).map(async blobKey => {
        if (asset.output[blobKey] instanceof CacheReference) {
          asset.output[blobKey] = await this.readBlob(
            asset.output[blobKey].filePath
          );
        }
      })
    );
  }

  async read(filePath: FilePath, env: Environment): Promise<CacheEntry | null> {
    if (this.invalidated.has(filePath)) {
      return null;
    }

    let cacheId = this.getCacheId(filePath, env);
    try {
      return await this.readBlob(this.getCachePath(cacheId));
    } catch (err) {
      return null;
    }
  }

  invalidate(filePath: FilePath) {
    this.invalidated.add(filePath);
  }

  async delete(filePath: FilePath, env: Environment) {
    try {
      let cacheId = this.getCacheId(filePath, env);
      // TODO: delete blobs
      await fs.unlink(this.getCachePath(cacheId));
      this.invalidated.delete(filePath);
    } catch (err) {
      // Fail silently
    }
  }
}

export class CacheReference {
  filePath: FilePath;
  constructor(filePath: FilePath) {
    this.filePath = filePath;
  }

  static deserialize(value: {filePath: FilePath}) {
    return new CacheReference(value.filePath);
  }
}

export default new Cache();
