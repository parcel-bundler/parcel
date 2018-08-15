const fs = require('@parcel/fs');
const pkg = require('../package.json');
const Path = require('path');
const md5 = require('@parcel/utils/md5');
const objectHash = require('@parcel/utils/objectHash');
const logger = require('@parcel/logger');

// These keys can affect the output, so if they differ, the cache should not match
const OPTION_KEYS = ['publicURL', 'minify', 'hmr', 'target', 'scopeHoist'];

class Cache {
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
    return Path.join(this.dir, cacheId.slice(0, 2), cacheId.slice(2) + extension);
  }

  async writeCacheFile(cacheId, data) {
    let cacheFilePath = this.getCachePath(cacheId);
    await fs.writeFile(cacheFilePath, JSON.stringify(data));
    return cacheFilePath;
  }

  async writeBlob(type, cacheId, data) {
    let blobPath = this.getCachePath(cacheId, '.' + type);
    await fs.writeFile(blobPath, typeof data === 'object' ? JSON.stringify(data) : data);
    return blobPath;
  }

  async _writeBlobs(assets) {
    return await Promise.all(
      assets.map(async asset => {
        let assetCacheId = this.getCacheId(asset.hash);
        asset.code = await this.writeBlob(asset.type, assetCacheId, asset.code);
        if (asset.map) {
          asset.map = await this.writeBlob(asset.type + '.map', assetCacheId, asset.map);
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
    return JSON.parse(await fs.readFile(this.getCachePath(cacheId), 'utf-8'));
  }

  async readBlob(blobKey) {
    return fs.readFile(blobKey);
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

module.exports = Cache;