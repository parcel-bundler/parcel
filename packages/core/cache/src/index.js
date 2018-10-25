import fs from '@parcel/fs';
import pkg from '../package.json';
import Path from 'path';
import md5 from '@parcel/utils/md5';
import objectHash from '@parcel/utils/objectHash';
import logger from '@parcel/logger';

// These keys can affect the output, so if they differ, the cache should not match
const OPTION_KEYS = ['publicURL', 'minify', 'hmr', 'target', 'scopeHoist'];

export default class Cache {
  constructor(options) {
    this.dir = Path.resolve(options.cacheDir || '.parcel-cache');
    this.dirExists = false;
    this.invalidated = new Set();
    this.optionsHash = objectHash(
      OPTION_KEYS.reduce((p, k) => ((p[k] = options[k]), p), {
        version: pkg.version
      })
    );
  }

  async ensureDirExists() {
    if (this.dirExists) {
      return;
    }

    await fs.mkdirp(this.dir);

    // Create sub-directories for every possible hex value
    // This speeds up large caches on many file systems since there are fewer files in a single directory.
    for (let i = 0; i < 256; i++) {
      await fs.mkdirp(Path.join(this.dir, ('00' + i.toString(16)).slice(-2)));
    }

    this.dirExists = true;
  }

  getCacheId(appendedData) {
    return md5(this.optionsHash + appendedData);
  }

  getCachePath(cacheId, extension = '.json') {
    return Path.join(
      this.dir,
      cacheId.slice(0, 2),
      cacheId.slice(2) + extension
    );
  }

  async writeCacheFile(cacheId, data) {
    return this.writeBlob('json', cacheId, JSON.stringify(data));
  }

  async writeBlob(type, cacheId, data) {
    let blobPath = this.getCachePath(cacheId, '.' + type);
    if (typeof data === 'object') {
      if (Buffer.isBuffer(data)) {
        blobPath += '.bin';
      } else {
        data = JSON.stringify(data);
        blobPath += '.json';
      }
    }
    await fs.writeFile(blobPath, data);
    return blobPath;
  }

  async _writeBlobs(assets) {
    return await Promise.all(
      assets.map(async asset => {
        let assetCacheId = this.getCacheId(asset.hash);
        for (let blobKey in asset.blobs) {
          asset.blobs[blobKey] = await this.writeBlob(
            blobKey,
            assetCacheId,
            asset.blobs[blobKey]
          );
        }
        return asset;
      })
    );
  }

  async writeBlobs(cacheEntry) {
    await this.ensureDirExists();

    cacheEntry.children = await this._writeBlobs(cacheEntry.children);
    if (cacheEntry.results) {
      cacheEntry.results = await this._writeBlobs(cacheEntry.results);
    }

    return cacheEntry;
  }

  async write(filePath, cacheEntry) {
    try {
      await this.ensureDirExists();
      let cacheId = this.getCacheId(filePath);
      await this.writeCacheFile(cacheId, cacheEntry);
      this.invalidated.delete(filePath);
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }

  async getCacheEntry(cacheId) {
    return this.readBlob(this.getCachePath(cacheId));
  }

  async readBlob(blobKey) {
    let extension = Path.extname(blobKey);
    let data = await fs.readFile(blobKey, {
      encoding: extension === '.bin' ? null : 'utf8'
    });
    if (extension === '.json') {
      data = JSON.parse(data);
    }
    return data;
  }

  async readBlobs(asset) {
    let blobs = {};
    await Promise.all(
      Object.keys(asset.blobs).map(async blobKey => {
        blobs[blobKey] = await this.readBlob(asset.blobs[blobKey]);
      })
    );
    return blobs;
  }

  async read(filePath) {
    if (this.invalidated.has(filePath)) {
      return null;
    }

    let cacheId = this.getCacheId(filePath);
    try {
      return await this.getCacheEntry(cacheId);
    } catch (err) {
      return null;
    }
  }

  invalidate(filePath) {
    this.invalidated.add(filePath);
  }

  async delete(filePath) {
    try {
      let cacheId = this.getCacheId(filePath);
      await fs.unlink(this.getCachePath(cacheId));
      this.invalidated.delete(filePath);
    } catch (err) {
      // Fail silently
    }
  }
}
